const fs = require("fs");
const { performance } = require("perf_hooks");
const db = require("../../db");
const { getBaselineManifest } = require("./baselineManifest");
const { getSchemaInventory } = require("./schemaInventory");

async function ensureBaselineHistory(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_baselines (
      version TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function hasUserObjects(client) {
  const { rows } = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relkind IN ('r', 'p')
        AND c.relname NOT IN ('schema_baselines', 'schema_migrations')
    ) AS exists
  `);
  return Boolean(rows[0]?.exists);
}

async function assertBaselineContract(client) {
  const requiredColumns = [
    ["analytics_events", "organisation_id"],
    ["analytics_events", "user_id"],
    ["analytics_events", "event_name"],
    ["analytics_events", "metadata"],
    ["analytics_events", "created_at"],
    ["help_chat_sessions", "session_id"],
    ["help_search_index", "search_vector"],
    ["outbox_events", "last_error"],
    ["cron_execution_logs", "error_summary"],
  ];

  const { rows } = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (${requiredColumns.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ")})
    `,
    requiredColumns.flat(),
  );
  const found = new Set(rows.map(({ table_name: table, column_name: column }) => `${table}.${column}`));
  const missing = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((column) => !found.has(column));

  const invalidIndexes = await client.query(`
    SELECT count(*)::int AS count
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND NOT i.indisvalid
  `);
  const unvalidatedConstraints = await client.query(`
    SELECT count(*)::int AS count
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND NOT c.convalidated
  `);

  if (missing.length || invalidIndexes.rows[0].count || unvalidatedConstraints.rows[0].count) {
    throw new Error(
      [
        ...missing.map((column) => `colonne requise absente: ${column}`),
        invalidIndexes.rows[0].count ? `${invalidIndexes.rows[0].count} index invalide(s)` : null,
        unvalidatedConstraints.rows[0].count ? `${unvalidatedConstraints.rows[0].count} contrainte(s) non validée(s)` : null,
      ].filter(Boolean).join("; "),
    );
  }
}

async function bootstrapBaselineV2() {
  const baseline = getBaselineManifest();
  const client = await db.pool.connect();
  let lockAcquired = false;

  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      ["madsuite:baseline:v2"],
    );
    if (!lock.rows[0]?.acquired) {
      throw new Error("Une autre opération de baseline est déjà en cours.");
    }
    lockAcquired = true;

    await ensureBaselineHistory(client);
    const existing = await client.query(
      "SELECT checksum FROM schema_baselines WHERE version = $1",
      [baseline.version],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== baseline.sha256) {
        throw new Error(`Baseline ${baseline.version} présente avec un checksum différent.`);
      }
      return { status: "already-applied", version: baseline.version };
    }

    if (await hasUserObjects(client)) {
      throw new Error(
        "Refus de poser la baseline v2 sur une base non vide. Crée une base vide dédiée; aucune table existante n'est écrasée.",
      );
    }

    const sql = fs.readFileSync(baseline.fullPath, "utf8");
    const started = performance.now();
    await client.query(sql);
    // pg_dump neutralise le search_path pendant la restauration; le runner
    // doit ensuite retrouver ses propres tables de suivi dans public.
    await client.query("SET search_path TO public");

    await client.query("BEGIN");
    try {
      await client.query(
        "INSERT INTO schema_baselines (version, checksum) VALUES ($1, $2)",
        [baseline.version, baseline.sha256],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const inventory = await getSchemaInventory(client);
    await assertBaselineContract(client);

    return {
      status: "applied",
      version: baseline.version,
      durationMs: Math.round(performance.now() - started),
      inventory: inventory.stats,
    };
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["madsuite:baseline:v2"]);
    }
    client.release();
  }
}

module.exports = { bootstrapBaselineV2 };
