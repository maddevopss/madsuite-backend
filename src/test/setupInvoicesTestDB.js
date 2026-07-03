const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.test"),
  override: false,
});

const TEST_DB_NAME = process.env.TEST_DB_NAME || "madsuite_test";
const DEBUG_SETUP = process.env.BACKEND_TEST_SETUP_DEBUG === "1";
const DEBUG_LOG_FILE = path.join(require("os").tmpdir(), "madsuite-backend-test-setup.log");

function debugLog(message) {
  if (!DEBUG_SETUP) return;
  const line = `[backend-test-setup] ${message}\n`;
  fs.appendFileSync(DEBUG_LOG_FILE, line, "utf8");
  console.log(line.trimEnd());
}

function getDatabaseNameFromConnectionString(value) {
  if (!value) return null;

  try {
    return new URL(value).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

function requireDbEnv() {
  const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD"].filter((key) => process.env[key] === undefined);

  if (missing.length > 0) {
    throw new Error(
      `Configuration PostgreSQL de test incomplete: ${missing.join(", ")} manquant(s). ` +
        "Ajoute ces variables dans backend/.env ou configure POSTGRES_ADMIN_URL/TEST_DATABASE_URL.",
    );
  }
}

function replaceDatabaseName(connectionString, databaseName) {
  return connectionString?.replace(/\/[^/?]+(\?.*)?$/, `/${databaseName}$1`);
}

function buildPoolConfig({ databaseName, explicitUrl }) {
  const connectionString = explicitUrl || replaceDatabaseName(process.env.DATABASE_URL, databaseName);

  if (connectionString) {
    return { connectionString };
  }

  requireDbEnv();

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD),
    database: databaseName,
  };
}

const adminPool = new Pool(
  buildPoolConfig({
    databaseName: "postgres",
    explicitUrl: process.env.POSTGRES_ADMIN_URL,
  }),
);

async function queryAdmin(sql, params = []) {
  await adminPool.query(sql, params);
}

async function waitForAdminDatabase(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await queryAdmin("SELECT 1");
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error(`PostgreSQL n'est pas pret a temps: ${lastError?.message || "timeout"}`);
}

async function recreateTestDatabase() {
  debugLog("recreate:start");
  if (!TEST_DB_NAME.endsWith("_test")) {
    throw new Error(`Refus de supprimer une DB non-test: ${TEST_DB_NAME}`);
  }

  const explicitTestDbName = getDatabaseNameFromConnectionString(process.env.TEST_DATABASE_URL);
  if (explicitTestDbName && explicitTestDbName !== TEST_DB_NAME) {
    throw new Error(`TEST_DATABASE_URL (${explicitTestDbName}) doit pointer vers TEST_DB_NAME (${TEST_DB_NAME})`);
  }

  await queryAdmin(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${TEST_DB_NAME}'
      AND pid <> pg_backend_pid();
  `);

  await queryAdmin(`DROP DATABASE IF EXISTS ${TEST_DB_NAME};`);
  await queryAdmin(`CREATE DATABASE ${TEST_DB_NAME};`);
  debugLog("recreate:done");
}

async function applySchemaToTestDatabase() {
  debugLog("schema:start");
  const testPool = new Pool(
    buildPoolConfig({
      databaseName: TEST_DB_NAME,
      explicitUrl: process.env.TEST_DATABASE_URL,
    }),
  );

  try {
    const migrationsSources = [
      path.join(__dirname, "../../db/archive/migrations"),
      path.join(__dirname, "../../db/migrations"),
    ];
    const migrations = [];
    const seen = new Set();

    for (const migrationsDir of migrationsSources) {
      if (!fs.existsSync(migrationsDir)) continue;

      const files = fs
        .readdirSync(migrationsDir)
        .filter((file) => /^\d+[a-z]?_.+\.sql$/i.test(file))
        .sort();

      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        migrations.push(file);
      }
    }

    // Fermer testPool avant de lancer les migrations externes pour éviter les deadlocks
    await testPool.end();
    
    // Exécuter les migrations réelles sur la base de test dans un nouveau processus
    // (cela permet à db.js de lire la bonne DATABASE_URL et évite les hangs)
    const { execSync } = require("child_process");
    const backendDir = path.resolve(__dirname, "../..");
    const migrationScript = path.join(backendDir, "src/migrate/runMigrations.js");
    // Utiliser des chemins relatifs avec forward slashes pour éviter les problèmes de backslash sur Windows
    const relativeScript = path.relative(backendDir, migrationScript).replace(/\\/g, "/");
    execSync(`node -e "require('./${relativeScript}').runMigrations({ backup: false }).then(()=>process.exit(0)).catch(e=>{ console.error(e.message); process.exit(1); })"`, {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      stdio: "inherit",
      cwd: backendDir
    });
    
    // Rouvrir pour le seed
    const seedPool = new Pool(buildPoolConfig({ databaseName: TEST_DB_NAME, explicitUrl: process.env.TEST_DATABASE_URL }));
    await seedE2EUsers(seedPool);
    await seedPool.end();
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function ensureE2EOrganisation(client) {
  const result = await client.query(
    `INSERT INTO organisations (id, nom) VALUES ($1, 'MADSuite Org') ON CONFLICT DO NOTHING`,
    [process.env.TEST_ORG_ID],
  );

  // Activer tous les modules pour l'organisation de test
  const modules = ['billing_assistant', 'activity_intelligence', 'dashboard', 'timesheet', 'clients', 'projects', 'invoices', 'reports', 'kiosk_punch', 'estimates'];
  for (const mod of modules) {
    await client.query(
      `INSERT INTO organisation_modules (organisation_id, module_key, is_active) VALUES ($1, $2, true) ON CONFLICT (organisation_id, module_key) DO UPDATE SET is_active = true`,
      [process.env.TEST_ORG_ID, mod]
    );
  }

  const hash = await bcrypt.hash(process.env.TEST_USER_PASSWORD, 10);

  if (result.rows[0]?.id) {
    return result.rows[0].id;
  }

  const existing = await client.query(
    `
    SELECT id
    FROM organisations
    WHERE nom = $1
    ORDER BY id
    LIMIT 1
    `,
    ["MADSuite E2E"],
  );

  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const fallback = await client.query(
    `
    SELECT id
    FROM organisations
    ORDER BY id
    LIMIT 1
    `,
  );

  if (!fallback.rows[0]?.id) {
    throw new Error("Impossible de créer ou trouver une organisation E2E.");
  }

  return fallback.rows[0].id;
}

async function seedE2EUsers(client) {
  const organisationId = await ensureE2EOrganisation(client);
  const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.TEST_USER_EMAIL;
  const password = process.env.E2E_PASSWORD || process.env.TEST_USER_PASSWORD;
  if (!adminEmail || !password) {
    throw new Error("TEST_USER_EMAIL et TEST_USER_PASSWORD sont requis pour initialiser les utilisateurs E2E.");
  }
  
  debugLog(`seedE2EUsers: adminEmail=${adminEmail}, password=${password}`);
  
  const passwordHash = await bcrypt.hash(password, 10);

  const users = [
    { nom: "Admin E2E", email: adminEmail, role: "admin" },
    { nom: "Employé E2E", email: process.env.E2E_EMPLOYEE_EMAIL || "user@test.com", role: "employe" },
    { nom: "Employé 2 E2E", email: "user2@test.com", role: "employe" },
  ];

  for (const user of users) {
    await client.query(
      `
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, organisation_id, role_org)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE
      SET nom = EXCLUDED.nom,
          mot_de_passe = EXCLUDED.mot_de_passe,
          role = EXCLUDED.role,
          organisation_id = EXCLUDED.organisation_id,
          role_org = EXCLUDED.role_org,
          deleted_at = NULL
      `,
      [user.nom, user.email, passwordHash, user.role, organisationId, user.role === "admin" ? "admin" : "user"],
    );
  }

  const check = await client.query(
    `
    SELECT email, role, organisation_id
    FROM utilisateurs
    WHERE email IN ($1, $2, $3)
    ORDER BY email
    `,
    [adminEmail, process.env.E2E_EMPLOYEE_EMAIL || "user@test.com", "user2@test.com"],
  );

  console.log("✅ Utilisateurs E2E seedés:", check.rows.map((row) => `${row.email}:${row.role}:org=${row.organisation_id}`).join(", "));
  debugLog("seed:done");

}

module.exports = async function setupInvoicesTestDB() {
  debugLog("setup:start");
  await waitForAdminDatabase();
  await recreateTestDatabase();
  await applySchemaToTestDatabase();
  await adminPool.end();
  debugLog("setup:done");
};

if (require.main === module) {
  module.exports().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
