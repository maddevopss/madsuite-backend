const pool = require("../../db");

const runIntegration = process.env.RUN_ACCOUNTING_POSTGRES_EVIDENCE === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("preuves PostgreSQL de la comptabilité complète", () => {
  let client;

  beforeAll(async () => {
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  test("les tables comptables obligatoires existent", async () => {
    const { rows } = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[
        "accounting_accounts",
        "accounting_entries",
        "accounting_entry_lines",
        "accounting_journals",
        "accounting_periods",
      ]],
    );

    expect(rows.map((row) => row.table_name)).toEqual([
      "accounting_accounts",
      "accounting_entries",
      "accounting_entry_lines",
      "accounting_journals",
      "accounting_periods",
    ]);
  });

  test("chaque écriture publiée est équilibrée au cent près", async () => {
    const { rows } = await client.query(
      `SELECT e.organisation_id,
              e.id AS entry_id,
              e.entry_number,
              ROUND(COALESCE(SUM(l.debit), 0)::numeric, 2) AS debit,
              ROUND(COALESCE(SUM(l.credit), 0)::numeric, 2) AS credit
       FROM accounting_entries e
       JOIN accounting_entry_lines l
         ON l.entry_id = e.id
        AND l.organisation_id = e.organisation_id
       WHERE e.status IN ('posted', 'reversed')
       GROUP BY e.organisation_id, e.id
       HAVING ROUND(COALESCE(SUM(l.debit), 0)::numeric, 2)
           <> ROUND(COALESCE(SUM(l.credit), 0)::numeric, 2)`,
    );

    expect(rows).toEqual([]);
  });

  test("aucune ligne comptable ne traverse une organisation", async () => {
    const { rows } = await client.query(
      `SELECT l.id AS line_id,
              l.organisation_id AS line_organisation_id,
              e.organisation_id AS entry_organisation_id,
              a.organisation_id AS account_organisation_id
       FROM accounting_entry_lines l
       JOIN accounting_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.organisation_id <> e.organisation_id
          OR l.organisation_id <> a.organisation_id`,
    );

    expect(rows).toEqual([]);
  });

  test("les écritures publiées conservent une source ou une justification", async () => {
    const { rows } = await client.query(
      `SELECT id, organisation_id, entry_number
       FROM accounting_entries
       WHERE status IN ('posted', 'reversed')
         AND NULLIF(BTRIM(COALESCE(description, '')), '') IS NULL
         AND source_id IS NULL
         AND NULLIF(BTRIM(COALESCE(source_type, '')), '') IS NULL`,
    );

    expect(rows).toEqual([]);
  });

  test("les numéros d’écriture sont uniques dans chaque organisation", async () => {
    const { rows } = await client.query(
      `SELECT organisation_id, entry_number, COUNT(*)::int AS occurrences
       FROM accounting_entries
       WHERE entry_number IS NOT NULL
       GROUP BY organisation_id, entry_number
       HAVING COUNT(*) > 1`,
    );

    expect(rows).toEqual([]);
  });
});
