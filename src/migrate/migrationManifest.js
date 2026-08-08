const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dbDir = path.join(__dirname, "../../db");
const manifestPath = path.join(dbDir, "migration-manifest.json");
const migrationFilePattern = /^\d+[a-z]?_.+\.sql$/i;
const unsupportedConstraintSyntax = /ALTER\s+TABLE[\s\S]*?ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i;
const transactionControl = /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im;

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function readManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Manifest de migrations invalide: ${error.message}`, { cause: error });
  }

  if (
    manifest.format !== 1 ||
    !Array.isArray(manifest.migrations) ||
    !Array.isArray(manifest.excluded) ||
    !Array.isArray(manifest.selfManaged)
  ) {
    throw new Error("Manifest de migrations invalide: format 1, migrations, excluded et selfManaged sont requis.");
  }

  return manifest;
}

function resolveManifestEntry(entry, kind) {
  const [relativePath, expectedHash] = Array.isArray(entry) ? entry : [];
  if (typeof relativePath !== "string" || typeof expectedHash !== "string") {
    throw new Error(`Entrée ${kind} invalide dans le manifest.`);
  }

  if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
    throw new Error(`Chemin invalide dans le manifest: ${relativePath}`);
  }

  const fullPath = path.resolve(dbDir, relativePath);
  const relativeToDb = path.relative(dbDir, fullPath);
  if (relativeToDb.startsWith("..") || !migrationFilePattern.test(path.basename(fullPath))) {
    throw new Error(`Chemin de migration refusé: ${relativePath}`);
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Migration absente: ${relativePath}`);
  }

  const actualHash = sha256(fullPath);
  if (actualHash !== expectedHash) {
    throw new Error(`Intégrité invalide: ${relativePath} a été modifié.`);
  }

  return {
    file: path.basename(fullPath),
    fullPath,
    relativePath: relativeToDb.replace(/\\/g, "/"),
    isArchive: relativeToDb.replace(/\\/g, "/").startsWith("archive/migrations/"),
  };
}

function listSqlFiles(directory, relativeDir) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory)
    .filter((file) => migrationFilePattern.test(file))
    .map((file) => `${relativeDir}/${file}`);
}

function assertManifestCoversDisk(manifestEntries) {
  const onDisk = new Set([
    ...listSqlFiles(path.join(dbDir, "archive/migrations"), "archive/migrations"),
    ...listSqlFiles(path.join(dbDir, "migrations"), "migrations"),
  ]);
  const declared = new Set(manifestEntries.map((entry) => entry.relativePath));

  const unknown = [...onDisk].filter((file) => !declared.has(file));
  const missing = [...declared].filter((file) => !onDisk.has(file));

  if (unknown.length || missing.length) {
    const details = [
      ...unknown.map((file) => `non déclarée: ${file}`),
      ...missing.map((file) => `absente: ${file}`),
    ];
    throw new Error(`Manifest de migrations incomplet:\n${details.map((line) => `- ${line}`).join("\n")}`);
  }
}

function getManifestMigrations() {
  const manifest = readManifest();
  const selfManagedPaths = new Set(manifest.selfManaged);
  const files = manifest.migrations.map((entry) => resolveManifestEntry(entry, "migration"));
  const excluded = manifest.excluded.map((entry) => resolveManifestEntry(entry, "exclue"));
  const filenames = new Set();
  const migrationPaths = new Set(files.map(({ relativePath }) => relativePath));

  for (const entry of files) {
    if (filenames.has(entry.file)) {
      throw new Error(`Nom de migration dupliqué dans le manifest: ${entry.file}`);
    }
    filenames.add(entry.file);
  }

  for (const relativePath of selfManagedPaths) {
    if (!migrationPaths.has(relativePath)) {
      throw new Error(`Migration self-managed absente du manifest: ${relativePath}`);
    }
  }

  for (const entry of files) {
    const hasTransactionControl = transactionControl.test(fs.readFileSync(entry.fullPath, "utf8"));
    const isSelfManaged = selfManagedPaths.has(entry.relativePath);
    if (hasTransactionControl !== isSelfManaged) {
      throw new Error(`Mode d'exécution manquant ou invalide: ${entry.relativePath}`);
    }
    entry.execution = isSelfManaged ? "self-managed" : "runner-managed";
  }

  assertManifestCoversDisk([...files, ...excluded]);
  return files;
}

function auditPendingMigrations(migrations, appliedMigrations, { allowLegacySelfManaged = false } = {}) {
  const applied = appliedMigrations instanceof Set ? appliedMigrations : new Set(appliedMigrations);
  const violations = [];

  for (const migration of migrations) {
    if (applied.has(migration.file)) continue;

    const sql = fs.readFileSync(migration.fullPath, "utf8");
    if (unsupportedConstraintSyntax.test(sql)) {
      violations.push({
        file: migration.file,
        rule: "ADD CONSTRAINT IF NOT EXISTS n'est pas supporté par PostgreSQL",
      });
    }
    if (transactionControl.test(sql) && migration.execution !== "self-managed") {
      violations.push({
        file: migration.file,
        rule: "contrôle de transaction top-level interdit dans une migration runner-managed",
      });
    }
    if (migration.execution === "self-managed" && !allowLegacySelfManaged) {
      violations.push({
        file: migration.file,
        rule: "migration legacy auto-transactionnelle: ALLOW_LEGACY_SELF_MANAGED_MIGRATIONS=1 requis",
      });
    }
  }

  return violations;
}

function assertPendingMigrationsAreRunnerSafe(migrations, appliedMigrations, options) {
  const violations = auditPendingMigrations(migrations, appliedMigrations, options);
  if (violations.length) {
    throw new Error(
      `Migrations pendantes non exécutables par le runner:\n${violations
        .map(({ file, rule }) => `- ${file}: ${rule}`)
        .join("\n")}`,
    );
  }
}

module.exports = {
  getManifestMigrations,
  auditPendingMigrations,
  assertPendingMigrationsAreRunnerSafe,
  manifestPath,
};
