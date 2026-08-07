const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

const target = process.env.BASELINE_V2_VERIFY_DB || "madsuite_v2_bootstrap_test";
if (!/^[a-z0-9_]+_test$/.test(target)) {
  throw new Error("BASELINE_V2_VERIFY_DB doit viser une base de test explicite.");
}

const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
url.pathname = `/${target}`;
process.env.NODE_ENV = "test";
process.env.TEST_DB_NAME = target;
process.env.TEST_DATABASE_URL = url.toString();

const db = require("../db");
const { runMigrations } = require("../src/migrate/runMigrations");

async function main() {
  await runMigrations();
  const { rows } = await db.query(`
    SELECT
      current_database() AS database,
      (SELECT count(*)::int FROM schema_baselines WHERE version = 'madsuite-schema-v2-20260807') AS baselines,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
      (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT i.indisvalid) AS invalid_indexes,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated) AS unvalidated_constraints,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_events' AND column_name='metadata') AS analytics_metadata,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_events' AND column_name IN ('properties', 'timestamp', 'event_timestamp')) AS legacy_analytics_columns
  `);
  const result = rows[0];
  if (
    result.baselines !== 1 ||
    result.invalid_indexes !== 0 ||
    result.unvalidated_constraints !== 0 ||
    result.analytics_metadata !== 1 ||
    result.legacy_analytics_columns !== 0
  ) {
    throw new Error(`Vérification baseline v2 échouée: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
