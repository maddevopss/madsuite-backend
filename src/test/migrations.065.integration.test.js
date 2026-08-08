const { Pool } = require("pg");

const MIGRATION_DB_NAME = process.env.MIGRATION_TEST_DB_NAME || "madsuite_migrations_065_test";
const originalDatabaseEnv = {
  TEST_DB_NAME: process.env.TEST_DB_NAME,
  DB_NAME: process.env.DB_NAME,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
};

let runMigrations;
let bootstrapBaselineV2;
let db;
let migrationPool;

function getTestDbName() {
  return MIGRATION_DB_NAME;
}

function buildDatabaseUrl(dbName) {
  const base = originalDatabaseEnv.TEST_DATABASE_URL || originalDatabaseEnv.DATABASE_URL;
  if (base) {
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    return url.toString();
  }

  const user = encodeURIComponent(process.env.DB_USER || "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD || "");
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

function configureMigrationDatabase() {
  const dbName = getTestDbName();
  const databaseUrl = buildDatabaseUrl(dbName);

  process.env.TEST_DB_NAME = dbName;
  process.env.DB_NAME = dbName;
  process.env.TEST_DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL = databaseUrl;
}

function loadMigrationRunner() {
  jest.resetModules();
  ({ runMigrations } = require("../migrate/runMigrations"));
  ({ bootstrapBaselineV2 } = require("../migrate/bootstrapBaselineV2"));
  db = require("../../db");
  migrationPool = db.pool;
}

async function closeMigrationPool() {
  if (migrationPool?.end) {
    await migrationPool.end();
    migrationPool = null;
  }
}

function restoreDatabaseEnvironment() {
  for (const [key, value] of Object.entries(originalDatabaseEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  jest.resetModules();
}

function assertSafeTestDatabase() {
  const db = getTestDbName();
  if (!db || !db.endsWith("_test")) {
    throw new Error(
      `migrations.065.integration.test: Refus de lancer sur une base non-test: ${db}. ` +
        "Configure TEST_DB_NAME (suffix _test) ou TEST_DATABASE_URL.",
    );
  }
}

async function recreateDb(dbName) {
  const adminPool = new Pool({
    connectionString: process.env.POSTGRES_ADMIN_URL,
  });

  try {
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${dbName}'
        AND pid <> pg_backend_pid();
    `);

    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName};`);
    await adminPool.query(`CREATE DATABASE ${dbName};`);
  } finally {
    await adminPool.end();
  }
}

describe("Migration 065: Repair Critical Runtime Schema", () => {
  beforeAll(() => {
    configureMigrationDatabase();
    assertSafeTestDatabase();
  });

  afterAll(async () => {
    await closeMigrationPool();
    restoreDatabaseEnvironment();
  });

  test("la baseline v2 crée les tables critiques", async () => {
    const dbName = getTestDbName();

    await recreateDb(dbName);
    loadMigrationRunner();

    await bootstrapBaselineV2();
    await runMigrations({ backup: false });

    // Vérifier que les tables existent maintenant
    const checkAfter = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('notifications', 'outbox_events', 'cron_execution_logs')
    `);
    const tablesAfter = checkAfter.rows.map((r) => r.table_name);
    expect(tablesAfter).toContain("notifications");
    expect(tablesAfter).toContain("outbox_events");
    expect(tablesAfter).toContain("cron_execution_logs");
  }, 180000);

  test("065 ajoute toutes les colonnes critiques", async () => {
    const dbName = getTestDbName();

    await closeMigrationPool();
    await recreateDb(dbName);
    loadMigrationRunner();

    await bootstrapBaselineV2();
    await runMigrations({ backup: false });

    // Vérifier les colonnes de outbox_events
    const outboxCols = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'outbox_events'
        AND column_name IN ('last_error', 'next_retry_at')
    `);
    const outboxColNames = outboxCols.rows.map((r) => r.column_name);
    expect(outboxColNames).toContain("last_error");
    expect(outboxColNames).toContain("next_retry_at");

    // Vérifier les colonnes de cron_execution_logs
    const cronCols = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'cron_execution_logs'
        AND column_name IN ('error_summary', 'keep_for_debug')
    `);
    const cronColNames = cronCols.rows.map((r) => r.column_name);
    expect(cronColNames).toContain("error_summary");
    expect(cronColNames).toContain("keep_for_debug");
  }, 180000);

  test("065 crée tous les index critiques", async () => {
    const dbName = getTestDbName();

    await closeMigrationPool();
    await recreateDb(dbName);
    loadMigrationRunner();

    await bootstrapBaselineV2();
    await runMigrations({ backup: false });

    // Vérifier les index de outbox_events
    const outboxIndexes = await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'outbox_events'
        AND indexname IN ('idx_outbox_events_status', 'idx_outbox_events_retry')
    `);
    const outboxIndexNames = outboxIndexes.rows.map((r) => r.indexname);
    expect(outboxIndexNames).toContain("idx_outbox_events_status");
    expect(outboxIndexNames).toContain("idx_outbox_events_retry");

    // Vérifier les index de cron_execution_logs
    const cronIndexes = await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'cron_execution_logs'
        AND indexname IN ('idx_cron_execution_logs_job_name', 'idx_cron_execution_logs_status', 'idx_cron_execution_logs_started_at')
    `);
    const cronIndexNames = cronIndexes.rows.map((r) => r.indexname);
    expect(cronIndexNames).toContain("idx_cron_execution_logs_job_name");
    expect(cronIndexNames).toContain("idx_cron_execution_logs_status");
    expect(cronIndexNames).toContain("idx_cron_execution_logs_started_at");
  }, 180000);

  test("065 est idempotente (peut être appliquée plusieurs fois)", async () => {
    const dbName = getTestDbName();

    await closeMigrationPool();
    await recreateDb(dbName);
    loadMigrationRunner();

    await bootstrapBaselineV2();
    await runMigrations({ backup: false });

    // Vérifier l'état après la première application
    const check1 = await db.query(`
      SELECT COUNT(*) as cnt
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('notifications', 'outbox_events', 'cron_execution_logs')
    `);
    const count1 = parseInt(check1.rows[0].cnt, 10);
    expect(count1).toBe(3);

    // Deuxième application : aucune migration ne doit être rejouée.
    await runMigrations({ backup: false });

    // Vérifier que l'état est identique
    const check2 = await db.query(`
      SELECT COUNT(*) as cnt
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('notifications', 'outbox_events', 'cron_execution_logs')
    `);
    const count2 = parseInt(check2.rows[0].cnt, 10);
    expect(count2).toBe(3);

    // Vérifier que les colonnes existent toujours
    const cols = await db.query(`
      SELECT COUNT(*) as cnt
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('outbox_events', 'cron_execution_logs')
        AND column_name IN ('last_error', 'next_retry_at', 'error_summary', 'keep_for_debug')
    `);
    const colCount = parseInt(cols.rows[0].cnt, 10);
    expect(colCount).toBe(4);
  }, 180000);

  test("assertRuntimeSchema() vérifie les colonnes critiques", async () => {
    const dbName = getTestDbName();

    await closeMigrationPool();
    await recreateDb(dbName);
    loadMigrationRunner();

    await bootstrapBaselineV2();
    await runMigrations({ backup: false });

    // assertRuntimeSchema() est appelée à la fin de runMigrations
    // Si elle passe sans erreur, c'est bon
    // Sinon, elle aurait levé une exception

    // Vérifier manuellement que les colonnes critiques existent
    const criticalCols = [
      { table: "outbox_events", column: "last_error" },
      { table: "outbox_events", column: "next_retry_at" },
      { table: "cron_execution_logs", column: "error_summary" },
      { table: "cron_execution_logs", column: "keep_for_debug" },
    ];

    for (const { table, column } of criticalCols) {
      const result = await db.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = $1
            AND column_name = $2
        ) AS ok
        `,
        [table, column],
      );
      expect(result.rows[0].ok).toBe(true);
    }
  }, 180000);
});
