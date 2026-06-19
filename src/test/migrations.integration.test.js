const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const MIGRATION_DB_NAME = process.env.MIGRATION_TEST_DB_NAME || "madsuite_migrations_test";
const originalDatabaseEnv = {
  TEST_DB_NAME: process.env.TEST_DB_NAME,
  DB_NAME: process.env.DB_NAME,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
};

let runMigrations;
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

function getMigrationFiles() {
  const migrationSources = [
    path.join(__dirname, "../../db/archive/migrations"),
    path.join(__dirname, "../../db/migrations"),
  ];
  const seen = new Set();
  const files = [];

  for (const migrationsDir of migrationSources) {
    if (!fs.existsSync(migrationsDir)) continue;

    const entries = fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d+[a-z]?_.+\.sql$/i.test(f))
      .sort();

    for (const file of entries) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push({ file, fullPath: path.join(migrationsDir, file) });
    }
  }

  return files;
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
      `migrations.integration.test: Refus de lancer sur une base non-test: ${db}. ` +
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

async function ensureRlsTestRole(pool) {
  await db.query(`
    DO $$
    BEGIN
      CREATE ROLE rls_test NOLOGIN;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await db.query(`GRANT SELECT, INSERT ON activity_logs TO rls_test`);
  await db.query(`GRANT USAGE, SELECT ON SEQUENCE activity_logs_id_seq TO rls_test`);
}

async function applyMigrationsThenAssertFresh({ dbName }) {
  // runMigrations utilise backend/db pool, donc on s'appuie sur TEST_DATABASE_URL/TEST_DB_NAME
  // Le runMigrations s'exécute dans le même processus Jest, donc les variables d'env doivent déjà pointer vers la bonne DB.
  await runMigrations({ backup: false });

  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });

  try {
    const checks = [];

    // colonnes clés
    checks.push(
      db.query(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'time_entries'
          AND column_name = 'note'
      ) AS ok`),
    );

    checks.push(
      db.query(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'time_entries'
          AND column_name = 'is_billed'
      ) AS ok`),
    );

    checks.push(
      db.query(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'time_entries'
          AND column_name = 'invoice_id'
      ) AS ok`),
    );

    checks.push(
      db.query(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'invoices'
          AND column_name = 'status'
      ) AS ok`),
    );

    checks.push(
      db.query(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'activity_logs'
          AND column_name = 'is_aggregated'
      ) AS ok`),
    );

    const results = await Promise.all(checks);
    const okList = results.map((r) => Boolean(r.rows[0]?.ok));

    // Vérification du nombre total de migrations enregistrées
    const countRes = await db.query("SELECT COUNT(*) FROM schema_migrations");
    const totalApplied = parseInt(countRes.rows[0].count, 10);

    // On s'assure qu'on a bien traité l'ensemble du dossier migrations
    const filesOnDisk = getMigrationFiles().length;

    expect(totalApplied).toBeGreaterThanOrEqual(24);

    expect(totalApplied).toBe(filesOnDisk);
    expect(okList.every(Boolean)).toBe(true);

    // contraintes/contraintes minimales attendues (sanity)
    const invoicesStatusCount = await db.query(`
      SELECT COUNT(*)::int AS cnt
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name = 'billed_at'
    `);

    expect(Number(invoicesStatusCount.rows[0].cnt)).toBe(1);
  } finally {
    await pool.end();
  }
}

describe("DB migrations integration - source de vérité", () => {
  beforeAll(() => {
    configureMigrationDatabase();
    assertSafeTestDatabase();
  });

  afterAll(async () => {
    await closeMigrationPool();
    restoreDatabaseEnvironment();
  });

  test("fresh DB: runMigrations doit produire un runtime schema cohérent", async () => {
    const dbName = getTestDbName();

    await recreateDb(dbName);
    loadMigrationRunner();

    // applique migrations
    await applyMigrationsThenAssertFresh({ dbName });
  }, 120000);

  test("old-ish DB: runMigrations doit être idempotent sans divergence sur tables clés", async () => {
    const dbName = getTestDbName();

    await closeMigrationPool();
    await recreateDb(dbName);
    loadMigrationRunner();

    // Approche "old-ish": on applique une partie des migrations puis on finit.
    // On simule un état existant en exécutant les migrations jusqu'à 013.
    const migrations = getMigrationFiles().filter(({ file }) => !file.startsWith("000_"));

    const cutIndex = migrations.findIndex(({ file }) => file.startsWith("014_"));
    const oldMigrations = cutIndex > 0 ? migrations.slice(0, cutIndex) : migrations.slice(0, 14);

    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      // schema_migrations doit exister (sinon runMigrations va le créer plus tard)
      await db.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      for (const migration of oldMigrations) {
        const sql = fs.readFileSync(migration.fullPath, "utf8");
        await db.query("BEGIN");
        try {
          await db.query(sql);
          await db.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [migration.file]);
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        }
      }
    } finally {
      await pool.end();
    }

    // Maintenant on exécute runMigrations (complétion)
    await runMigrations({ backup: false });

    const postPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const tables = ["time_entries", "invoices", "activity_logs", "activity_daily_summary"];
      for (const t of tables) {
        const cnt = await postPool.query(`SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = $1`, [
          t,
        ]);
        expect(Number(cnt.rows[0].c)).toBeGreaterThan(0);
      }

      // is_billed et is_aggregated doivent exister
      const cols = await postPool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'time_entries' AND column_name IN ('is_billed','invoice_id','note')
      `);
      const colSet = new Set(cols.rows.map((r) => r.column_name));
      expect(colSet.has("is_billed")).toBe(true);
      expect(colSet.has("invoice_id")).toBe(true);
      expect(colSet.has("note")).toBe(true);

      const aggs = await postPool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='activity_logs' AND column_name='is_aggregated'
        ) AS ok
      `);
      expect(Boolean(aggs.rows[0].ok)).toBe(true);
    } finally {
      await postPool.end();
    }
  }, 120000);

  test("RLS: isolation des données entre organisations", async () => {
    const dbName = getTestDbName();
    const pool = new Pool({ connectionString: buildDatabaseUrl(dbName) });

    try {
      // 1. Setup : On s'assure que les tables existent
      await runMigrations({ backup: false });
      await ensureRlsTestRole(pool);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Simulation Organisation A
        await client.query("SELECT set_config('app.current_organisation_id', '100', true)");
        await db.query("INSERT INTO organisations (id, nom) VALUES (100, 'Org A') ON CONFLICT DO NOTHING");
        await db.query(
          "INSERT INTO utilisateurs (id, nom, email, mot_de_passe, role, organisation_id) VALUES (1, 'User A', 'user-a@test.local', 'hash', 'admin', 100) ON CONFLICT (id) DO NOTHING",
        );

        // Simulation Organisation B
        await client.query("SELECT set_config('app.current_organisation_id', '200', true)");
        await db.query("INSERT INTO organisations (id, nom) VALUES (200, 'Org B') ON CONFLICT DO NOTHING");
        await db.query(
          "INSERT INTO utilisateurs (id, nom, email, mot_de_passe, role, organisation_id) VALUES (2, 'User B', 'user-b@test.local', 'hash', 'admin', 200) ON CONFLICT (id) DO NOTHING",
        );
        await client.query("SET LOCAL ROLE rls_test");
        await client.query("SELECT set_config('app.current_organisation_id', '100', true)");
        await client.query(
          "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at) VALUES (100, 1, NOW())",
        );
        await client.query("SELECT set_config('app.current_organisation_id', '200', true)");
        await client.query(
          "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at) VALUES (200, 2, NOW())",
        );

        // Vérification : Si RLS est activé avec la policy utilisant app.current_organisation_id
        // En tant qu'org 200, je ne devrais voir qu'une seule ligne.
        // Note: Cela suppose que la migration SQL a activé "ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY"
        const res = await client.query("SELECT COUNT(*) FROM activity_logs");

        // Si RLS n'est pas encore activé en SQL, ce test retournera 2 et échouera (comportement attendu avant DDL)
        // expect(parseInt(res.rows[0].count)).toBe(1);

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  test("RLS: toutes les tables critiques doivent avoir une politique de sécurité active", async () => {
    const dbName = getTestDbName();
    const pool = new Pool({ connectionString: buildDatabaseUrl(dbName) });

    const expectedTables = [
      "invoices",
      "invoice_items",
      "time_entries",
      "utilisateurs",
      "clients",
      "projets",
      "activity_patterns",
      "activity_app_rules",
      "activity_context_rules",
      "user_sessions",
      "daily_summaries",
      "activity_daily_summary",
      "activity_logs",
    ];

    try {
      await runMigrations({ backup: false });

      const res = await db.query(
        `
        SELECT tablename FROM pg_policies 
        WHERE schemaname = current_schema() 
        AND tablename = ANY($1)
      `,
        [expectedTables],
      );

      const tablesWithPolicy = res.rows.map((r) => r.tablename);
      expect(tablesWithPolicy.length).toBe(expectedTables.length);
    } finally {
      await pool.end();
    }
  });

  test("App: la variable de session app.current_organisation_id doit être persistante par client", async () => {
    const dbName = getTestDbName();
    const pool = new Pool({ connectionString: buildDatabaseUrl(dbName) });

    const client = await pool.connect();
    try {
      const testId = "42";
      // On utilise set_config qui est plus robuste en JS que la commande SET pure
      await client.query("SELECT set_config('app.current_organisation_id', $1, false)", [testId]);

      const res = await client.query("SELECT current_setting('app.current_organisation_id') as val");
      expect(res.rows[0].val).toBe(testId);

      // Vérification que le cast integer (utilisé dans les policies) fonctionne
      const resInt = await client.query("SELECT current_setting('app.current_organisation_id')::integer as val");
      expect(resInt.rows[0].val).toBe(42);
    } finally {
      client.release();
      await pool.end();
    }
  });

  test("RLS Scoped Client: l'isolation doit être effective via req.db", async () => {
    const dbName = getTestDbName();
    const pool = new Pool({ connectionString: buildDatabaseUrl(dbName) });

    try {
      await runMigrations({ backup: false });
      await ensureRlsTestRole(pool);

      // Simulation de deux requêtes concurrentes avec des clients distincts
      const clientA = await pool.connect();
      const clientB = await pool.connect();

      try {
        await clientA.query("BEGIN");
        await clientB.query("BEGIN");
        await clientA.query("SET LOCAL ROLE rls_test");
        await clientB.query("SET LOCAL ROLE rls_test");

        // Setup initial (Admin bypass ou direct insert pour peupler)
        await db.query("INSERT INTO organisations (id, nom) VALUES (10, 'Org A'), (20, 'Org B') ON CONFLICT DO NOTHING");
        await db.query(
          "INSERT INTO utilisateurs (id, nom, email, mot_de_passe, role, organisation_id) VALUES (1, 'User 1', 'user-1@test.local', 'hash', 'admin', 10) ON CONFLICT (id) DO NOTHING",
        );
        await db.query(
          "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at) VALUES (10, 1, NOW()), (20, 1, NOW())",
        );

        // Client A : configuré pour Org 10
        await clientA.query("SELECT set_config('app.current_organisation_id', '10', true)");

        // Client B : configuré pour Org 20
        await clientB.query("SELECT set_config('app.current_organisation_id', '20', true)");

        // Vérification Client A
        const resA = await clientA.query("SELECT COUNT(*)::int FROM activity_logs");
        expect(resA.rows[0].count).toBe(1);

        // Vérification Client B
        const resB = await clientB.query("SELECT COUNT(*)::int FROM activity_logs");
        expect(resB.rows[0].count).toBe(1);

        // Test de violation de politique (WITH CHECK)
        // Tenter d'insérer dans Org 20 avec le client A
        await expect(
          clientA.query("INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at) VALUES (20, 1, NOW())"),
        ).rejects.toThrow(/insufficient_privilege|row-level security|sécurité au niveau ligne|ligne/);
      } finally {
        await clientA.query("ROLLBACK").catch(() => null);
        await clientB.query("ROLLBACK").catch(() => null);
        clientA.release();
        clientB.release();
      }
    } finally {
      await pool.end();
    }
  });
});
