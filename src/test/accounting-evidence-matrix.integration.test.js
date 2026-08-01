const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { seedDefaultChart, createEntry, postEntry } = require("../services/business/accounting.service");

// Auparavant gardé derrière RUN_ACCOUNTING_POSTGRES_EVIDENCE=true
// (describe.skip par défaut, donc jamais exécuté par `npm test`) et
// n'insérait aucune donnée : les invariants ci-dessous passaient vide sur
// une base de test sans écritures comptables, sans rien prouver. On insère
// désormais de vraies écritures posées avant de vérifier ces invariants
// GLOBAUX (toutes organisations confondues, pas seulement celles créées
// ici) — la valeur de ce test est justement de détecter une violation
// n'importe où dans la base, pas seulement dans les données qu'il crée.
describe("preuves PostgreSQL de la comptabilité complète", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();

    const org = await createTestOrganisation({ nom: "Preuves Comptables E2E Org" });
    await seedDefaultChart(client, org.id);
    const accounts = await client.query(
      "SELECT id, code FROM accounting_accounts WHERE organisation_id=$1 AND code IN ('1000','4000')",
      [org.id],
    );
    const cash = accounts.rows.find((row) => row.code === "1000");
    const revenue = accounts.rows.find((row) => row.code === "4000");

    const entry = await createEntry(client, org.id, null, {
      entryDate: "2026-01-08",
      description: "Preuve d'invariants — vente au comptant",
      lines: [
        { accountId: cash.id, debit: 60, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 60 },
      ],
    });
    await postEntry(client, org.id, entry.id);
  });

  afterAll(() => {
    // Ne PAS appeler pool.end() ici : db.pool est un singleton partagé par
    // tous les fichiers de test exécutés dans le même worker Jest — le
    // fermer casserait toute suite s'exécutant après celle-ci.
    client.release();
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
