/*
 * Construit la baseline v2 à partir d'une base legacy de référence, dans une
 * nouvelle base jetable. Ce script ne touche jamais à la source ni à madsuite.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

const sourceDb = process.env.BASELINE_V2_SOURCE_DB || "madsuite_migrations_test";
const candidateDb = process.env.BASELINE_V2_CANDIDATE_DB || "madsuite_v2_candidate_test";
const root = path.resolve(__dirname, "../..");
const dbDir = path.join(root, "backend", "db");
const outputFile = path.join(dbDir, "baselines", "madsuite-schema-v2.sql");
const manifestFile = path.join(dbDir, "baseline-v2-manifest.json");
const curatedAdditions = [
  path.join(dbDir, "migrations", "20260806_help_chat.sql"),
  path.join(dbDir, "migrations", "20260806_help_search_index.sql"),
];
const dumpExclusions = [
  "--exclude-table=schema_migrations*",
  "--exclude-table=schema_migrations_executed*",
  "--exclude-table=schema_baselines*",
];

function assertSafeDatabaseName(name, label) {
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`${label} doit être une base de test explicite (suffixe _test).`);
  }
}

function findPgTool(name) {
  const requested = process.env[`${name.toUpperCase()}_PATH`];
  if (requested) return requested;
  const windowsTool = `C:\\Program Files\\PostgreSQL\\18\\bin\\${name}.exe`;
  return fs.existsSync(windowsTool) ? windowsTool : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw new Error(`${path.basename(command)}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${path.basename(command)}: ${(result.stderr || result.stdout || "échec").trim()}`);
}

function connectionFor(name) {
  const raw = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL ou DATABASE_URL est requis.");
  const url = new URL(raw);
  url.pathname = `/${name}`;
  return url;
}

function cliConnection(url) {
  const env = { ...process.env };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  if (url.searchParams.get("sslmode")) env.PGSSLMODE = url.searchParams.get("sslmode");
  return {
    args: ["-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username), "-d", url.pathname.slice(1)],
    env,
  };
}

function normalizeDump(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\\(?:connect|restrict|unrestrict)\b/.test(line))
    // transaction_timeout a ete ajoute apres PostgreSQL 16.
    .filter((line) => !/^SET transaction_timeout\s*=\s*/i.test(line))
    .join("\n");
  return `-- MADSuite PostgreSQL baseline v2\n-- Générée de façon contrôlée; ne pas éditer à la main.\n${content.trim()}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function verifySource(url) {
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const [ledger, analytics] = await Promise.all([
      pool.query("SELECT count(*)::int AS count FROM schema_migrations"),
      pool.query(`
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS columns
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'analytics_events'
      `),
    ]);
    if (ledger.rows[0].count !== 260) {
      throw new Error(`Source refusée: ${ledger.rows[0].count} migrations, 260 attendues.`);
    }
    const expected = "id,organisation_id,user_id,event_name,metadata,created_at";
    if (analytics.rows[0].columns !== expected) {
      throw new Error("Source refusée: contrat analytics_events inattendu.");
    }
  } finally {
    await pool.end();
  }
}

async function validateCandidate(url) {
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const result = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
        (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT i.indisvalid) AS invalid_indexes,
        (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated) AS unvalidated_constraints,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_events' AND column_name='metadata') AS analytics_metadata,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_events' AND column_name IN ('properties', 'timestamp', 'event_timestamp')) AS legacy_analytics_columns,
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('help_chat_sessions', 'help_chat_messages', 'help_chat_context', 'help_search_index')) AS active_help_tables
    `);
    const row = result.rows[0];
    if (row.invalid_indexes || row.unvalidated_constraints || row.analytics_metadata !== 1 || row.legacy_analytics_columns !== 0 || row.active_help_tables !== 4) {
      throw new Error(`Candidate invalide: ${JSON.stringify(row)}`);
    }
    return row;
  } finally {
    await pool.end();
  }
}

async function main() {
  assertSafeDatabaseName(sourceDb, "BASELINE_V2_SOURCE_DB");
  assertSafeDatabaseName(candidateDb, "BASELINE_V2_CANDIDATE_DB");
  if (sourceDb === candidateDb) throw new Error("La source et le candidat doivent être distincts.");

  const sourceUrl = connectionFor(sourceDb);
  const candidateUrl = connectionFor(candidateDb);
  await verifySource(sourceUrl);

  const adminUrl = process.env.POSTGRES_ADMIN_URL;
  if (!adminUrl) throw new Error("POSTGRES_ADMIN_URL est requis pour créer la base candidate.");
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [candidateDb]);
    await admin.query(`DROP DATABASE IF EXISTS ${candidateDb}`);
    await admin.query(`CREATE DATABASE ${candidateDb}`);
  } finally {
    await admin.end();
  }

  const pgDump = findPgTool("pg_dump");
  const psql = findPgTool("psql");
  const tempDump = path.join(os.tmpdir(), `madsuite-v2-${Date.now()}.sql`);
  const sourceCli = cliConnection(sourceUrl);
  const candidateCli = cliConnection(candidateUrl);
  try {
    run(pgDump, ["--schema-only", "--no-owner", "--no-privileges", ...dumpExclusions, "-f", tempDump, ...sourceCli.args], { env: sourceCli.env });
    run(psql, ["-v", "ON_ERROR_STOP=1", "-f", tempDump, ...candidateCli.args], { env: candidateCli.env });
    for (const file of curatedAdditions) {
      run(psql, ["-v", "ON_ERROR_STOP=1", "-f", file, ...candidateCli.args], { env: candidateCli.env });
    }

    const inventory = await validateCandidate(candidateUrl);
    const candidateDump = path.join(os.tmpdir(), `madsuite-v2-candidate-${Date.now()}.sql`);
    try {
      run(pgDump, ["--schema-only", "--no-owner", "--no-privileges", ...dumpExclusions, "-f", candidateDump, ...candidateCli.args], { env: candidateCli.env });
      const baseline = normalizeDump(candidateDump);
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, baseline, "utf8");
      const checksum = sha256(baseline);
      fs.writeFileSync(manifestFile, `${JSON.stringify({
        format: 1,
        version: "madsuite-schema-v2-20260807",
        file: "baselines/madsuite-schema-v2.sql",
        sha256: checksum,
        source: { database: sourceDb, appliedLegacyMigrations: 260 },
        curatedAdditions: curatedAdditions.map((file) => path.relative(dbDir, file).replace(/\\/g, "/")),
      }, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ candidate: candidateDb, baseline: path.relative(root, outputFile), checksum, inventory }));
    } finally {
      fs.rmSync(candidateDump, { force: true });
    }
  } finally {
    fs.rmSync(tempDump, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
