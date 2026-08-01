// Preuve d'exécution réelle pour le domaine 1.G (rapprochement bancaire),
// premier micro-bloc : modèle de relevé et correspondance manuelle avec le
// grand livre. accounting-reconciliation.service.js existant rapproche des
// documents métier à leur écriture comptable — ce domaine est différent :
// il rapproche un relevé bancaire externe aux mouvements déjà publiés sur
// un compte de trésorerie.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { seedDefaultChart, createEntry, postEntry } = require("../services/business/accounting.service");
const {
  createStatement,
  getStatement,
  listStatements,
  addStatementLines,
  listStatementLines,
  matchLine,
  unmatchLine,
  getReconciliationSummary,
  lockStatement,
} = require("../services/business/bank-reconciliation.service");

async function getAccountByCode(client, organisationId, code) {
  const { rows } = await client.query(`SELECT * FROM accounting_accounts WHERE organisation_id=$1 AND code=$2`, [organisationId, code]);
  return rows[0];
}

describe("Rapprochement bancaire par relevé (domaine 1.G)", () => {
  let client;
  let orgA;
  let orgB;
  let bankAccountA;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Rapprochement E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Rapprochement E2E Org B" });
    await seedDefaultChart(client, orgA.id);
    await seedDefaultChart(client, orgB.id);
    bankAccountA = await getAccountByCode(client, orgA.id, "1010");
  });

  afterAll(() => {
    client.release();
  });

  test("création d'un relevé et import de lignes", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: 1000,
      closingBalance: 1500,
    });
    expect(statement.status).toBe("open");

    const lines = await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-01-05", description: "Dépôt client", amount: 500 },
      { lineDate: "2026-01-10", description: "Frais bancaires", amount: -25 },
    ]);
    expect(lines).toHaveLength(2);

    const listed = await listStatements(client, orgA.id, {});
    expect(listed.some((row) => row.id === statement.id)).toBe(true);

    const fetched = await getStatement(client, orgA.id, statement.id);
    expect(fetched.id).toBe(statement.id);
  });

  test("correspondance manuelle : montant exact requis, compte requis, verrouillage après rapprochement complet", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      openingBalance: 0,
      closingBalance: 500,
    });
    const [depositLine] = await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-02-10", description: "Dépôt client réel", amount: 500 },
    ]);

    // Écriture réelle publiée touchant le compte bancaire du relevé.
    const revenue = await getAccountByCode(client, orgA.id, "4000");
    const draft = await createEntry(client, orgA.id, null, {
      entryDate: "2026-02-10",
      description: "Vente encaissée",
      lines: [
        { accountId: bankAccountA.id, debit: 500, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 500 },
      ],
    });
    await postEntry(client, orgA.id, draft.id);
    const entryLines = await client.query(
      "SELECT * FROM accounting_entry_lines WHERE entry_id=$1 AND account_id=$2",
      [draft.id, bankAccountA.id],
    );
    const bankEntryLineId = entryLines.rows[0].id;

    // Un montant qui ne concorde pas doit être refusé.
    await expect(
      matchLine(client, orgA.id, depositLine.id, { entryLineId: bankEntryLineId + 999999 }),
    ).rejects.toThrow("introuvable");

    const matched = await matchLine(client, orgA.id, depositLine.id, { entryLineId: bankEntryLineId, matchedBy: null });
    expect(matched.status).toBe("matched");

    // Une deuxième correspondance sur la même ligne de relevé est refusée.
    await expect(
      matchLine(client, orgA.id, depositLine.id, { entryLineId: bankEntryLineId }),
    ).rejects.toThrow("déjà une correspondance");

    const summary = await getReconciliationSummary(client, orgA.id, statement.id);
    expect(summary.fullyReconciled).toBe(true);
    expect(summary.matchedTotal).toBe(500);
    expect(summary.difference).toBe(0);

    const locked = await lockStatement(client, orgA.id, statement.id, null);
    expect(locked.duplicate).toBe(false);
    expect(locked.statement.status).toBe("locked");

    // Verrouiller à nouveau est idempotent.
    const lockedAgain = await lockStatement(client, orgA.id, statement.id, null);
    expect(lockedAgain.duplicate).toBe(true);

    // Un relevé verrouillé refuse toute nouvelle modification.
    await expect(
      addStatementLines(client, orgA.id, statement.id, [{ lineDate: "2026-02-20", description: "Trop tard", amount: 1 }]),
    ).rejects.toThrow("verrouillé");
    await expect(unmatchLine(client, orgA.id, depositLine.id)).rejects.toThrow("verrouillé");
  });

  test("un relevé avec des lignes non rapprochées ne peut pas être verrouillé", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      openingBalance: 0,
      closingBalance: 200,
    });
    await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-03-05", description: "Dépôt non rapproché", amount: 200 },
    ]);

    await expect(lockStatement(client, orgA.id, statement.id, null)).rejects.toThrow("ne peut être verrouillé");
  });

  test("annuler une correspondance la rend à nouveau disponible", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id,
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      openingBalance: 0,
      closingBalance: 300,
    });
    const [line] = await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-04-05", description: "Dépôt à annuler", amount: 300 },
    ]);

    const revenue = await getAccountByCode(client, orgA.id, "4000");
    const draft = await createEntry(client, orgA.id, null, {
      entryDate: "2026-04-05",
      description: "Vente encaissée (annulation test)",
      lines: [
        { accountId: bankAccountA.id, debit: 300, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 300 },
      ],
    });
    await postEntry(client, orgA.id, draft.id);
    const entryLine = await client.query("SELECT id FROM accounting_entry_lines WHERE entry_id=$1 AND account_id=$2", [draft.id, bankAccountA.id]);

    await matchLine(client, orgA.id, line.id, { entryLineId: entryLine.rows[0].id });
    const unmatched = await unmatchLine(client, orgA.id, line.id);
    expect(unmatched.status).toBe("unmatched");
    expect(unmatched.matched_entry_line_id).toBeNull();
  });

  test("isolation stricte entre deux organisations", async () => {
    const statementsOrgB = await listStatements(client, orgB.id, {});
    expect(statementsOrgB).toEqual([]);

    await expect(
      createStatement(client, orgB.id, {
        accountId: bankAccountA.id, // compte de orgA
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        openingBalance: 0,
        closingBalance: 0,
      }),
    ).rejects.toThrow("introuvable");
  });
});
