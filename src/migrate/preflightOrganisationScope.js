const db = require("../../db");

const REQUIRED_ORG_TABLES = [
  { table: "utilisateurs", column: "organisation_id" },
  { table: "clients", column: "organisation_id" },
  { table: "projets", column: "organisation_id" },
  { table: "time_entries", column: "organisation_id" },
  { table: "invoices", column: "organisation_id" },
  { table: "activity_logs", column: "organisation_id" },
  { table: "activity_daily_summary", column: "organisation_id" },
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists;
    `,
    [table],
  );

  return Boolean(rows[0]?.exists);
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists;
    `,
    [table, column],
  );

  return Boolean(rows[0]?.exists);
}

async function countNullOrganisationRows(client, table, column) {
  const sql = `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} IS NULL;`;
  const { rows } = await client.query(sql);
  return Number(rows[0]?.count || 0);
}

async function runOrganisationScopePreflight({ client = db.pool } = {}) {
  const failures = [];

  for (const item of REQUIRED_ORG_TABLES) {
    const exists = await tableExists(client, item.table);
    if (!exists) continue;

    const hasColumn = await columnExists(client, item.table, item.column);
    if (!hasColumn) {
      failures.push(`${item.table}.${item.column} est manquant`);
      continue;
    }

    const nullCount = await countNullOrganisationRows(client, item.table, item.column);
    if (nullCount > 0) {
      failures.push(`${item.table}: ${nullCount} ligne(s) avec ${item.column} = NULL`);
    }
  }

  if (failures.length) {
    const message = [
      "Preflight DB échoué: organisation_id contient encore des valeurs NULL.",
      "Corrige/backfill ces lignes avant d'appliquer les contraintes NOT NULL.",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n");

    const err = new Error(message);
    err.failures = failures;
    throw err;
  }

  return { success: true, checkedTables: REQUIRED_ORG_TABLES.map((item) => item.table) };
}

async function main() {
  try {
    const result = await runOrganisationScopePreflight();
    console.log("Preflight organisation_id OK", result);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_ORG_TABLES,
  runOrganisationScopePreflight,
};
