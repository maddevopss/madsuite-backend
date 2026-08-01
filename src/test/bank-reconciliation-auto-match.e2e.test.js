// Preuve d'exécution réelle pour la correspondance automatique du
// rapprochement bancaire (domaine 1.G, micro-bloc 3/3) : les suggestions
// ne sont jamais appliquées silencieusement — seules les correspondances
// univoques (un seul candidat) sont applicables, seulement après
// confirmation humaine explicite ; les correspondances ambiguës restent
// pour résolution manuelle.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { seedDefaultChart, createEntry, postEntry } = require("../services/business/accounting.service");
const {
  createStatement,
  addStatementLines,
  listStatementLines,
  suggestMatches,
  applySuggestedMatches,
  lockStatement,
} = require("../services/business/bank-reconciliation.service");

async function getAccountByCode(client, organisationId, code) {
  const { rows } = await client.query(`SELECT * FROM accounting_accounts WHERE organisation_id=$1 AND code=$2`, [organisationId, code]);
  return rows[0];
}

async function postBankEntry(client, organisationId, bankAccountId, revenueAccountId, { entryDate, amount, description }) {
  const draft = await createEntry(client, organisationId, null, {
    entryDate,
    description,
    lines: [
      { accountId: bankAccountId, debit: amount, credit: 0 },
      { accountId: revenueAccountId, debit: 0, credit: amount },
    ],
  });
  await postEntry(client, organisationId, draft.id);
  const line = await client.query("SELECT * FROM accounting_entry_lines WHERE entry_id=$1 AND account_id=$2", [draft.id, bankAccountId]);
  return line.rows[0];
}

describe("Correspondance automatique du rapprochement bancaire (domaine 1.G)", () => {
  let client;
  let orgA;
  let bankAccountA;
  let revenueAccountA;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Auto-Match E2E Org A" });
    await seedDefaultChart(client, orgA.id);
    bankAccountA = await getAccountByCode(client, orgA.id, "1010");
    revenueAccountA = await getAccountByCode(client, orgA.id, "4000");
  });

  afterAll(() => {
    client.release();
  });

  test("une correspondance univoque est suggérée et appliquée après confirmation humaine", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id, periodStart: "2026-05-01", periodEnd: "2026-05-31", openingBalance: 0, closingBalance: 750,
    });
    const [line] = await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-05-10", description: "Dépôt à rapprocher automatiquement", amount: 750 },
    ]);
    const entryLine = await postBankEntry(client, orgA.id, bankAccountA.id, revenueAccountA.id, {
      entryDate: "2026-05-11", amount: 750, description: "Vente encaissée (auto-match)",
    });

    const suggestions = await suggestMatches(client, orgA.id, statement.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].matchable).toBe(true);
    expect(suggestions[0].ambiguous).toBe(false);
    expect(suggestions[0].candidates[0].entry_line_id).toBe(entryLine.id);

    await expect(
      applySuggestedMatches(client, orgA.id, statement.id, { confirmedByHuman: false }),
    ).rejects.toThrow("confirmation humaine");

    const result = await applySuggestedMatches(client, orgA.id, statement.id, { confirmedByHuman: true, matchedBy: null });
    expect(result.appliedCount).toBe(1);
    expect(result.skippedCount).toBe(0);

    const linesAfter = await listStatementLines(client, orgA.id, statement.id);
    expect(linesAfter.find((row) => row.id === line.id).status).toBe("matched");

    const locked = await lockStatement(client, orgA.id, statement.id, null);
    expect(locked.statement.status).toBe("locked");
  });

  test("une correspondance ambiguë (plusieurs candidats) n'est jamais appliquée automatiquement", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id, periodStart: "2026-06-01", periodEnd: "2026-06-30", openingBalance: 0, closingBalance: 0,
    });
    const [line] = await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-06-15", description: "Dépôt ambigu", amount: 200 },
    ]);

    // Deux écritures distinctes au même montant, dans la fenêtre de dates :
    // impossible de choisir automatiquement laquelle correspond.
    await postBankEntry(client, orgA.id, bankAccountA.id, revenueAccountA.id, { entryDate: "2026-06-14", amount: 200, description: "Vente A" });
    await postBankEntry(client, orgA.id, bankAccountA.id, revenueAccountA.id, { entryDate: "2026-06-16", amount: 200, description: "Vente B" });

    const suggestions = await suggestMatches(client, orgA.id, statement.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].ambiguous).toBe(true);
    expect(suggestions[0].matchable).toBe(false);
    expect(suggestions[0].candidates).toHaveLength(2);

    const result = await applySuggestedMatches(client, orgA.id, statement.id, { confirmedByHuman: true });
    expect(result.appliedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]).toEqual({ statementLineId: line.id, reason: "ambiguous" });

    const linesAfter = await listStatementLines(client, orgA.id, statement.id);
    expect(linesAfter.find((row) => row.id === line.id).status).toBe("unmatched");
  });

  test("aucun candidat hors de la fenêtre de dates n'est proposé", async () => {
    const statement = await createStatement(client, orgA.id, {
      accountId: bankAccountA.id, periodStart: "2026-07-01", periodEnd: "2026-07-31", openingBalance: 0, closingBalance: 0,
    });
    await addStatementLines(client, orgA.id, statement.id, [
      { lineDate: "2026-07-15", description: "Dépôt sans candidat proche", amount: 999 },
    ]);
    await postBankEntry(client, orgA.id, bankAccountA.id, revenueAccountA.id, { entryDate: "2026-07-01", amount: 999, description: "Vente trop ancienne" });

    const suggestions = await suggestMatches(client, orgA.id, statement.id, { dateWindowDays: 5 });
    expect(suggestions[0].candidates).toHaveLength(0);
    expect(suggestions[0].matchable).toBe(false);
  });

  test("un relevé verrouillé refuse toute application de correspondances automatiques", async () => {
    // Réutilise le relevé verrouillé par le premier scénario de ce fichier.
    const lockedStatement = (await client.query(
      "SELECT id FROM bank_statements WHERE organisation_id=$1 AND status='locked' ORDER BY id LIMIT 1",
      [orgA.id],
    )).rows[0];

    await expect(
      applySuggestedMatches(client, orgA.id, lockedStatement.id, { confirmedByHuman: true }),
    ).rejects.toThrow("verrouillé");
  });
});
