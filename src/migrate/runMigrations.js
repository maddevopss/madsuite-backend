const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");
const db = require("../../db");
const { runOrganisationScopePreflight } = require("./preflightOrganisationScope");

function log(message, details) {
  // pas de secrets
  if (details) console.log(message, details);
  else console.log(message);
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function getMigrationFiles() {
  const sources = [path.join(__dirname, "../../db/archive/migrations"), path.join(__dirname, "../../db/migrations")];

  const seen = new Set();
  const entries = [];

  for (const migrationsDir of sources) {
    if (!fs.existsSync(migrationsDir)) continue;

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d+[a-z]?_.+\.sql$/i.test(f))
      .sort();

    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      entries.push({
        file,
        fullPath: path.join(migrationsDir, file),
      });
    }
  }

  if (!entries.length) {
    throw new Error(`Aucune migration SQL trouvée dans ${sources.join(", ")}`);
  }

  return entries;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getAppliedMigrations(client) {
  // On vérifie d'abord si la nouvelle table existe, sinon on se rabat sur l'ancienne
  const tableExists = await client.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations_executed')
  `);

  const tableName = tableExists.rows[0].exists ? "schema_migrations_executed" : "schema_migrations";
  const column = tableExists.rows[0].exists ? "version" : "filename";

  const { rows } = await client.query(`SELECT ${column} as file FROM ${tableName}`);
  return new Set(rows.map((r) => r.file));
}

function getMigrationsSnapshotPath() {
  if (process.env.NODE_ENV === "test") return null;
  const snapshotPath = path.join(__dirname, "../../db/schema_current.sql");
  return fileExists(snapshotPath) ? snapshotPath : null;
}

async function applyBaselineSnapshot(client, snapshotPath) {
  const sql = fs.readFileSync(snapshotPath, "utf8");
  await client.query(sql);
}

async function recordMigrationSnapshot(client, files) {
  for (const file of files) {
    await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
  }

  const hasTelemetry = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations_executed')`,
  );
  if (hasTelemetry.rows[0].exists) {
    for (const file of files) {
      await client.query(
        `
        INSERT INTO schema_migrations_executed (version, name, duration_ms, status)
        VALUES ($1, $2, 0, 'success')
        ON CONFLICT (version) DO UPDATE SET status = 'success', duration_ms = 0
        `,
        [file, file],
      );
    }
  }
}

async function applyMigration(client, { fullPath, file }) {
  const sql = fs.readFileSync(fullPath, "utf8");
  const startTime = performance.now();

  await client.query(`BEGIN`);
  try {
    await client.query(sql);

    // On insère dans les deux tables pour la compatibilité descendante
    await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);

    // Si la table de télémétrie existe (créée par 024), on enregistre le succès
    const hasTelemetry = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations_executed')`,
    );
    if (hasTelemetry.rows[0].exists) {
      const duration = Math.round(performance.now() - startTime);
      await client.query(
        `
        INSERT INTO schema_migrations_executed (version, name, duration_ms, status)
        VALUES ($1, $2, $3, 'success') ON CONFLICT (version) DO UPDATE SET status = 'success', duration_ms = $3
      `,
        [file, file, duration],
      );
    }

    await client.query(`COMMIT`);
    log(`Migration appliquée: ${file}`);
  } catch (e) {
    await client.query(`ROLLBACK`);

    const duplicateMigrationObject =
      e?.code === "42710" ||
      e?.code === "42P07" ||
      /already exists|existe|exists/i.test(String(e?.message || ""));

    if (duplicateMigrationObject) {
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);

      const hasTelemetry = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations_executed')`,
      );
      if (hasTelemetry.rows[0].exists) {
        await client.query(
          `
          INSERT INTO schema_migrations_executed (version, name, duration_ms, status)
          VALUES ($1, $2, 0, 'success')
          ON CONFLICT (version) DO UPDATE SET status = 'success', duration_ms = 0
          `,
          [file, file],
        );
      }

      log(`Migration déjà présente: ${file}`);
      return;
    }

    // En cas d'échec, on tente de logguer l'erreur si la table existe
    try {
      await client.query(
        `
        INSERT INTO schema_migrations_executed (version, name, status)
        VALUES ($1, $1, 'failed') ON CONFLICT (version) DO UPDATE SET status = 'failed'
      `,
        [file],
      );
    } catch (logErr) {
      /* Table peut-être pas encore créée */
    }

    throw e;
  }
}

async function assertRuntimeSchema(client) {
  const required = [
    // billing
    { table: "time_entries", column: "note", hint: "007_timer_quick_note.sql" },
    { table: "time_entries", column: "is_billed", hint: "006_billing_and_timestamptz.sql" },
    { table: "time_entries", column: "invoice_id", hint: "006_billing_and_timestamptz.sql" },
    { table: "invoices", column: "status", hint: "009_invoices_billing_metadata.sql" },
    { table: "invoices", column: "billed_at", hint: "009_invoices_billing_metadata.sql" },

    // compliance / retention
    { table: "activity_logs", column: "is_aggregated", hint: "018_add_is_aggregated_to_activity_logs.sql" },
    { table: "activity_daily_summary", column: "activity_date", hint: "003_seed.sql" },
    { table: "business_audit_logs", column: "created_at", hint: "013_business_audit_logs.sql" },
  ];

  const failures = [];

  for (const req of required) {
    const { rows } = await client.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2
      ) AS ok
      `,
      [req.table, req.column],
    );

    if (!rows[0]?.ok) {
      failures.push(`${req.table}.${req.column} est absente (attendu via ${req.hint}).`);
    }
  }

  if (failures.length) {
    throw new Error(
      "Schéma incomplet: le runtime schema ne correspond pas aux colonnes clés.\n" +
        failures.map((f) => `- ${f}`).join("\n"),
    );
  }
}

function maybeBackupDatabase() {
  // Optionnel : active via ENABLE_DB_BACKUP=1
  const enabled = String(process.env.ENABLE_DB_BACKUP || "").toLowerCase() === "1";
  if (!enabled) return;

  const outDir = process.env.DB_BACKUP_DIR || path.join(process.cwd(), "db-backups");
  if (!fileExists(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outfile = path.join(outDir, `madsuite-${process.env.DB_NAME || "db"}-${stamp}.dump.sql`);

  const pgDump = process.env.PGDUMP_PATH || "pg_dump";

  const args = [
    "-h",
    process.env.DB_HOST,
    "-p",
    String(process.env.DB_PORT),
    "-U",
    process.env.DB_USER,
    "-d",
    process.env.DB_NAME,
    "--format=plain",
    "--no-owner",
    "--no-acl",
    "-f",
    outfile,
  ];

  // Utilise PGPASSWORD (évite de logger DB_PASSWORD)
  const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };

  log(`Backup DB (pg_dump) -> ${outfile}`);
  const res = spawnSync(pgDump, args, { env, stdio: "inherit", windowsHide: true });
  if (res.error) {
    throw new Error(`pg_dump erreur: ${res.error.message}`);
  }
}

async function runMigrations({ backup = false } = {}) {
  const client = await db.pool.connect();
  let tableLockAcquired = false;
  const runnerId = process.env.HOSTNAME || "local-runner";

  try {
    // 1. Tenter d'acquérir le verrou via la table (Step 6)
    // On vérifie d'abord si la table existe
    const hasLockTable = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migration_lock')`,
    );

    if (hasLockTable.rows[0].exists) {
      const lockRes = await client.query(
        `
        UPDATE schema_migration_lock 
        SET is_locked = TRUE, locked_at = NOW(), locked_by = $1
        WHERE id = 1 AND is_locked = FALSE
        RETURNING *
      `,
        [runnerId],
      );

      if (lockRes.rows.length === 0) {
        throw new Error("Une autre instance de migration est déjà en cours (verrou table actif).");
      }
      tableLockAcquired = true;
      log("Verrou de migration acquis (table).");
    }

    if (backup) {
      maybeBackupDatabase();
    }

    await ensureMigrationsTable(client);

    const migrations = getMigrationFiles();
    const applied = await getAppliedMigrations(client);
    let appliedCount = 0;
    let skippedCount = 0;
    const snapshotPath = getMigrationsSnapshotPath();

    if (applied.size === 0 && snapshotPath) {
      log("Base vide détectée, application du snapshot courant...");
      await client.query(`BEGIN`);
      try {
        await applyBaselineSnapshot(client, snapshotPath);
        await recordMigrationSnapshot(
          client,
          migrations.map((m) => m.file),
        );
        await client.query(`COMMIT`);
        await assertRuntimeSchema(client);
        log(`Snapshot appliqué: ${path.basename(snapshotPath)}; migrations marquées: ${migrations.length}`);
        return;
      } catch (e) {
        await client.query(`ROLLBACK`);
        throw e;
      }
    }

    // Appliquer seulement les non-appliquées
    for (const m of migrations) {
      if (applied.has(m.file)) {
        skippedCount++;
        continue;
      }

      if (m.file === "012_organisation_id_not_null_and_constraints.sql") {
        log("Preflight organisation_id avant contraintes strictes...");
        await runOrganisationScopePreflight({ client });
      }

      await applyMigration(client, m);
      appliedCount++;
    }

    await assertRuntimeSchema(client);
    log(`Migrations terminées. Appliquées: ${appliedCount}, Déjà présentes: ${skippedCount}, Total: ${migrations.length}`);
  } finally {
    try {
      if (tableLockAcquired) {
        await client.query(`
          UPDATE schema_migration_lock SET is_locked = FALSE, locked_by = NULL WHERE id = 1
        `);
        log("Verrou de migration libéré.");
      }
    } finally {
      client.release();
    }
  }
}

module.exports = { runMigrations };
