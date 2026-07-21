param(
  [string]$SourceDatabaseUrl = $env:SOURCE_DATABASE_URL,
  [string]$TargetDatabaseUrl = $env:TARGET_DATABASE_URL,
  [string]$ArtifactsRoot = "artifacts/backup-restore"
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Commande requise absente du PATH : $Name"
  }
}

function Invoke-PsqlScalar([string]$DatabaseUrl, [string]$Sql) {
  $value = & psql $DatabaseUrl -v ON_ERROR_STOP=1 -qAt -c $Sql
  if ($LASTEXITCODE -ne 0) {
    throw "Échec psql pour la requête : $Sql"
  }
  return ($value | Out-String).Trim()
}

function Test-TableExists([string]$DatabaseUrl, [string]$TableName) {
  return (Invoke-PsqlScalar $DatabaseUrl "SELECT to_regclass('public.$TableName') IS NOT NULL;") -eq "t"
}

function Get-DatabaseMetrics([string]$DatabaseUrl) {
  $tables = @(
    "organisations",
    "utilisateurs",
    "clients",
    "projets",
    "time_entries",
    "invoices",
    "ledger_entries"
  )

  $metrics = [ordered]@{}

  foreach ($table in $tables) {
    if (Test-TableExists $DatabaseUrl $table) {
      $metrics[$table] = [int64](Invoke-PsqlScalar $DatabaseUrl "SELECT COUNT(*) FROM public.$table;")
    } else {
      $metrics[$table] = "ABSENT"
    }
  }

  $migrationRows = [int64]0
  $migrationTables = @("schema_migrations", "_prisma_migrations")
  $presentMigrationTables = @()

  foreach ($migrationTable in $migrationTables) {
    if (Test-TableExists $DatabaseUrl $migrationTable) {
      $presentMigrationTables += $migrationTable
      $migrationRows += [int64](Invoke-PsqlScalar $DatabaseUrl "SELECT COUNT(*) FROM public.$migrationTable;")
    }
  }

  $metrics["migration_rows"] = $migrationRows
  $metrics["migration_tables"] = if ($presentMigrationTables.Count -gt 0) {
    $presentMigrationTables -join ","
  } else {
    "NONE"
  }
  $metrics["rls_policies"] = [int64](Invoke-PsqlScalar $DatabaseUrl "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';")
  $metrics["rls_enabled_tables"] = [int64](Invoke-PsqlScalar $DatabaseUrl "SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity;")
  $metrics["constraints"] = [int64](Invoke-PsqlScalar $DatabaseUrl "SELECT COUNT(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public';")
  $metrics["indexes"] = [int64](Invoke-PsqlScalar $DatabaseUrl "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';")

  return $metrics
}

function Write-Metrics([System.Collections.IDictionary]$Metrics, [string]$Path) {
  $Metrics.GetEnumerator() |
    ForEach-Object { "{0}={1}" -f $_.Key, $_.Value } |
    Set-Content -Path $Path -Encoding UTF8
}

Require-Command "pg_dump"
Require-Command "pg_restore"
Require-Command "psql"

if ([string]::IsNullOrWhiteSpace($SourceDatabaseUrl)) {
  throw "SOURCE_DATABASE_URL est requis."
}

if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) {
  throw "TARGET_DATABASE_URL est requis."
}

if ($SourceDatabaseUrl -eq $TargetDatabaseUrl) {
  throw "La base source et la base cible doivent être différentes."
}

if ($env:MADPROOF_ALLOW_DESTRUCTIVE_RESTORE -ne "YES") {
  throw "Restauration destructive refusée. Définir MADPROOF_ALLOW_DESTRUCTIVE_RESTORE=YES pour une base cible jetable."
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$runDirectory = Join-Path $ArtifactsRoot $runId
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null

$dumpPath = Join-Path $runDirectory "madsuite.dump"
$sourceMetricsPath = Join-Path $runDirectory "source-metrics.txt"
$targetMetricsPath = Join-Path $runDirectory "target-metrics.txt"
$policiesPath = Join-Path $runDirectory "target-rls-policies.txt"
$summaryPath = Join-Path $runDirectory "proof-summary.txt"

Write-Host "[1/6] Collecte des invariants source"
$sourceMetrics = Get-DatabaseMetrics $SourceDatabaseUrl
Write-Metrics $sourceMetrics $sourceMetricsPath

Write-Host "[2/6] Création du dump PostgreSQL"
& pg_dump $SourceDatabaseUrl --format=custom --no-owner --no-privileges --file=$dumpPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump a échoué."
}

Write-Host "[3/6] Nettoyage explicite de la base cible"
& psql $TargetDatabaseUrl -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
if ($LASTEXITCODE -ne 0) {
  throw "Nettoyage de la base cible échoué."
}

Write-Host "[4/6] Restauration dans la base cible"
& pg_restore --dbname=$TargetDatabaseUrl --no-owner --no-privileges --exit-on-error $dumpPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore a échoué."
}

Write-Host "[5/6] Collecte et comparaison des invariants restaurés"
$targetMetrics = Get-DatabaseMetrics $TargetDatabaseUrl
Write-Metrics $targetMetrics $targetMetricsPath

$differences = @()
foreach ($key in $sourceMetrics.Keys) {
  if ($sourceMetrics[$key].ToString() -ne $targetMetrics[$key].ToString()) {
    $differences += "$key : source=$($sourceMetrics[$key]) cible=$($targetMetrics[$key])"
  }
}

& psql $TargetDatabaseUrl -v ON_ERROR_STOP=1 -P pager=off -c "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;" |
  Set-Content -Path $policiesPath -Encoding UTF8
if ($LASTEXITCODE -ne 0) {
  throw "Collecte des politiques RLS échouée."
}

Write-Host "[6/6] Production du résumé"
$summary = @(
  "MADPROOF backup/restore proof",
  "run_id=$runId",
  "dump=$dumpPath",
  "source_metrics=$sourceMetricsPath",
  "target_metrics=$targetMetricsPath",
  "rls_policies=$policiesPath",
  "differences=$($differences.Count)"
)

if ($differences.Count -gt 0) {
  $summary += "status=FAILED"
  $summary += $differences
  $summary | Set-Content -Path $summaryPath -Encoding UTF8
  throw "La restauration ne respecte pas les invariants. Voir $summaryPath"
}

$requiredTables = @("organisations", "utilisateurs", "clients", "projets", "invoices", "ledger_entries")
$missingRequiredTables = $requiredTables | Where-Object { $targetMetrics[$_] -eq "ABSENT" }
if ($missingRequiredTables.Count -gt 0) {
  $summary += "status=FAILED"
  $summary += "missing_required_tables=$($missingRequiredTables -join ',')"
  $summary | Set-Content -Path $summaryPath -Encoding UTF8
  throw "Tables critiques absentes après restauration : $($missingRequiredTables -join ', ')"
}

if ([int64]$targetMetrics["rls_policies"] -le 0) {
  $summary += "status=FAILED"
  $summary += "reason=no_rls_policy"
  $summary | Set-Content -Path $summaryPath -Encoding UTF8
  throw "Aucune politique RLS trouvée après restauration."
}

if ([int64]$targetMetrics["rls_enabled_tables"] -le 0) {
  $summary += "status=FAILED"
  $summary += "reason=no_rls_enabled_table"
  $summary | Set-Content -Path $summaryPath -Encoding UTF8
  throw "Aucune table avec RLS active trouvée après restauration."
}

$summary += "status=PASSED"
$summary | Set-Content -Path $summaryPath -Encoding UTF8

Write-Host "Preuve de sauvegarde/restauration réussie : $summaryPath"
