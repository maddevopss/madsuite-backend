// Preuve d'exécution réelle pour l'issue #310 (écarts 1, 2, 3, 4, 6, 8) : le
// mainteneur a rouvert le bloc en constatant que sa fermeture reposait sur
// des tests contractuels (fichiers de 30-60 lignes vérifiant la présence
// textuelle de code, ou des mocks intégraux de la base) plutôt que sur une
// exécution réelle. Ce test exécute le cycle comptable complet contre une
// vraie base PostgreSQL : plan comptable hiérarchique et périodes, journal
// (brouillon → publication → contrepassation non destructive), grand livre
// avec soldes d'ouverture/fermeture, balance comparative et détection
// d'incohérences, automatisation facture → paiement (anti double
// comptabilisation), états financiers retraçables, et isolation stricte
// entre deux organisations.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { createAccount, createPeriod } = require("../services/business/accounting-masterdata.service");
const { createEntry, postEntry, reverseEntry, seedDefaultChart } = require("../services/business/accounting.service");
const { getLedger } = require("../services/business/accounting-ledger.service");
const { getComparativeTrialBalance } = require("../services/business/accounting-trial-balance.service");
const { getComparativeStatements } = require("../services/business/accounting-statements-comparative.service");
const { cashFlow } = require("../services/business/accounting-export.service");
const {
  recordInvoiceFinalizationAccounting,
  recordInvoicePaymentAccounting,
} = require("../services/business/accounting-sync.service");
const { reversePostedEntry } = require("../services/business/accounting-reversal-governance.service");

jest.mock("../services/business/trust-persistence.service", () => ({
  persistTrustAssessment: jest.fn().mockResolvedValue({ assessmentId: 1 }),
  persistGraphEdges: jest.fn().mockResolvedValue({}),
}));

async function getAccountByCode(client, organisationId, code) {
  const { rows } = await client.query(
    `SELECT * FROM accounting_accounts WHERE organisation_id=$1 AND code=$2`,
    [organisationId, code],
  );
  return rows[0];
}

describe("Cycle comptable complet (#310)", () => {
  let client;
  let orgA;
  let orgB;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Comptabilité E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Comptabilité E2E Org B" });
    await seedDefaultChart(client, orgA.id);
    await seedDefaultChart(client, orgB.id);
  });

  afterAll(async () => {
    client.release();
  });

  test("écart #1 — plan comptable hiérarchique réel et détection de chevauchement de périodes", async () => {
    const cashAccount = await getAccountByCode(client, orgA.id, "1000");

    const subAccount = await createAccount(client, orgA.id, {
      code: "1005",
      name: "Petite caisse — succursale",
      accountType: "asset",
      normalBalance: "debit",
      parentId: cashAccount.id,
    });
    expect(subAccount.parent_id).toBe(cashAccount.id);

    await expect(
      createAccount(client, orgA.id, {
        code: "1006",
        name: "Compte incohérent",
        accountType: "liability",
        normalBalance: "credit",
        parentId: cashAccount.id,
      }),
    ).rejects.toThrow("même famille comptable");

    const period = await createPeriod(client, orgA.id, {
      fiscalYear: 2026,
      periodNumber: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
    });
    expect(period.status).toBe("open");

    await expect(
      createPeriod(client, orgA.id, {
        fiscalYear: 2026,
        periodNumber: 1,
        startsOn: "2026-01-15",
        endsOn: "2026-02-15",
      }),
    ).rejects.toThrow("chevauche");
  });

  test("écart #2 — journal transactionnel : brouillon, publication, contrepassation non destructive", async () => {
    const cash = await getAccountByCode(client, orgA.id, "1000");
    const revenue = await getAccountByCode(client, orgA.id, "4000");

    const draft = await createEntry(client, orgA.id, null, {
      entryDate: "2026-01-05",
      description: "Vente au comptant",
      lines: [
        { accountId: cash.id, debit: 100, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 100 },
      ],
    });
    expect(draft.status).toBe("draft");

    const posted = await postEntry(client, orgA.id, draft.id);
    expect(posted.status).toBe("posted");
    expect(posted.posted_at).not.toBeNull();

    // La contrepassation en production passe par reversePostedEntry
    // (accounting-reversal-governance.service.js), le même moteur déjà
    // prouvé pour la correction de cycles de paie (#318, PR #679) — c'est
    // la seule voie réellement câblée sur POST /entries/:id/reverse.
    const reversal = await reversePostedEntry({
      organisationId: orgA.id,
      entryId: draft.id,
      reversalDate: "2026-01-06",
      reason: "Erreur de saisie détectée (test e2e)",
      idempotencyKey: `accounting-reversal-e2e:${draft.id}`,
      confirmedByHuman: true,
      reversedBy: null,
    });
    expect(reversal.duplicate).toBe(false);

    const originalAfterReversal = await client.query("SELECT status FROM accounting_entries WHERE id=$1", [draft.id]);
    expect(originalAfterReversal.rows[0].status).toBe("reversed");

    const reversalEntry = await client.query("SELECT status FROM accounting_entries WHERE id=$1", [reversal.reversal.id]);
    expect(reversalEntry.rows[0].status).toBe("posted");

    const reversalLines = await client.query(
      "SELECT COALESCE(SUM(debit),0)::numeric AS debit, COALESCE(SUM(credit),0)::numeric AS credit FROM accounting_entry_lines WHERE entry_id=$1",
      [reversal.reversal.id],
    );
    expect(Number(reversalLines.rows[0].debit)).toBeCloseTo(Number(reversalLines.rows[0].credit), 2);
    expect(Number(reversalLines.rows[0].debit)).toBeCloseTo(100, 2);
  });

  test("écart #6 — automatisation facture → paiement, sans double comptabilisation", async () => {
    const invoiceId = `e2e-inv-${Date.now()}`;
    await client.query("BEGIN");
    let finalization;
    try {
      finalization = await recordInvoiceFinalizationAccounting({
        client,
        organisationId: orgA.id,
        invoiceId,
        invoiceNumber: "FAC-E2E-001",
        subtotal: 200,
        taxTotal: 30,
        total: 230,
        issueDate: "2026-01-10",
        createdBy: null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    expect(finalization.duplicate).toBe(false);

    // Republier la même facture est un no-op idempotent : aucune deuxième
    // écriture, exactement l'invariant "sans double comptabilisation" exigé
    // par le critère de fermeture de #310.
    await client.query("BEGIN");
    let duplicateFinalization;
    try {
      duplicateFinalization = await recordInvoiceFinalizationAccounting({
        client,
        organisationId: orgA.id,
        invoiceId,
        invoiceNumber: "FAC-E2E-001",
        subtotal: 200,
        taxTotal: 30,
        total: 230,
        issueDate: "2026-01-10",
        createdBy: null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    expect(duplicateFinalization.duplicate).toBe(true);
    expect(duplicateFinalization.entryId).toBe(finalization.entryId);

    const paymentId = `e2e-pmt-${Date.now()}`;
    await client.query("BEGIN");
    let payment;
    try {
      payment = await recordInvoicePaymentAccounting({
        client,
        organisationId: orgA.id,
        paymentId,
        invoiceNumber: "FAC-E2E-001",
        amount: 230,
        receivedAt: "2026-01-12",
        createdBy: null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    expect(payment.duplicate).toBe(false);

    const paymentLines = await client.query(
      "SELECT COALESCE(SUM(debit),0)::numeric AS debit, COALESCE(SUM(credit),0)::numeric AS credit FROM accounting_entry_lines WHERE entry_id=$1",
      [payment.entryId],
    );
    expect(Number(paymentLines.rows[0].debit)).toBeCloseTo(Number(paymentLines.rows[0].credit), 2);
    expect(Number(paymentLines.rows[0].debit)).toBeCloseTo(230, 2);
  });

  test("écart #3 — grand livre filtrable avec soldes d'ouverture et de fermeture", async () => {
    const cash = await getAccountByCode(client, orgA.id, "1000");
    const ledger = await getLedger(client, orgA.id, {
      accountId: cash.id,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    expect(ledger.accounts).toHaveLength(1);
    const account = ledger.accounts[0];
    expect(account.code).toBe("1000");
    // Vente au comptant (100$ débit) contrepassée (100$ crédit) : le solde de
    // fermeture pour janvier revient donc à zéro sur ce compte.
    expect(account.openingBalance).toBeCloseTo(0, 2);
    expect(account.closingBalance).toBeCloseTo(0, 2);
    expect(account.movements.length).toBeGreaterThanOrEqual(2);
  });

  test("écart #4 — balance comparative équilibrée et détection réelle d'une écriture incohérente", async () => {
    const balanced = await getComparativeTrialBalance(client, orgA.id, {
      current: { startDate: "2026-01-01", endDate: "2026-01-31" },
      previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
    });
    expect(balanced.isBalanced).toBe(true);
    expect(balanced.anomalies).toEqual([]);

    // L'application ne permet jamais de publier une écriture déséquilibrée
    // (validateEntryLines/postEntry le refusent) : pour prouver que le
    // détecteur d'anomalies fonctionne réellement, on simule la seule façon
    // dont une telle ligne pourrait exister — une altération directe de la
    // base contournant la couche applicative. Une fois 'posted', une
    // écriture est immuable au niveau base (déclencheurs sur
    // accounting_entries ET accounting_entry_lines) : impossible de la
    // supprimer ou de revenir en arrière ensuite. On fait donc toute la
    // simulation dans une transaction explicite qu'on annule (ROLLBACK) une
    // fois la détection prouvée, pour ne rien laisser polluer les autres
    // fichiers de test qui partagent ce même cluster PostgreSQL éphémère
    // (ex. accounting-evidence-matrix.integration.test.js, qui vérifie cet
    // invariant globalement, toutes organisations confondues).
    const cash = await getAccountByCode(client, orgA.id, "1000");
    const revenue = await getAccountByCode(client, orgA.id, "4000");
    const journal = await client.query("SELECT id FROM accounting_journals WHERE organisation_id=$1 AND code='GEN'", [orgA.id]);

    await client.query("BEGIN");
    try {
      const corrupted = await client.query(
        `INSERT INTO accounting_entries (organisation_id, journal_id, entry_number, entry_date, description, status)
         VALUES ($1,$2,'CORRUPT-E2E-001','2026-01-20','Écriture corrompue (test)','draft') RETURNING id`,
        [orgA.id, journal.rows[0].id],
      );
      await client.query(
        `INSERT INTO accounting_entry_lines (organisation_id, entry_id, account_id, debit, credit) VALUES ($1,$2,$3,50,0)`,
        [orgA.id, corrupted.rows[0].id, cash.id],
      );
      await client.query(
        `INSERT INTO accounting_entry_lines (organisation_id, entry_id, account_id, debit, credit) VALUES ($1,$2,$3,0,40)`,
        [orgA.id, corrupted.rows[0].id, revenue.id],
      );
      await client.query(
        `UPDATE accounting_entries SET status='posted', posted_at=NOW() WHERE id=$1`,
        [corrupted.rows[0].id],
      );

      const withAnomaly = await getComparativeTrialBalance(client, orgA.id, {
        current: { startDate: "2026-01-01", endDate: "2026-01-31" },
        previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
      });
      expect(withAnomaly.isBalanced).toBe(false);
      const anomaly = withAnomaly.anomalies.find((row) => row.entryNumber === "CORRUPT-E2E-001");
      expect(anomaly).toBeDefined();
      expect(anomaly.type).toBe("unbalanced_entry");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  test("écart #5 (bonus) — états financiers et flux de trésorerie reflètent les écritures réelles", async () => {
    const statements = await getComparativeStatements(client, orgA.id, {
      current: { startDate: "2026-01-01", endDate: "2026-01-31" },
      previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
    });
    expect(statements.statements.incomeStatement.netIncome.current).toBeGreaterThan(0);

    const flow = await cashFlow(db, orgA.id, "2026-01-01", "2026-01-31");
    expect(flow.traceable).toBe(true);
    // Encaissement de la facture (230$ au compte bancaire 1010) : le
    // mouvement net de trésorerie doit refléter ce dépôt réel.
    expect(flow.netCashMovement).toBeGreaterThanOrEqual(230);
  });

  test("écart #8 — isolation stricte entre deux organisations", async () => {
    const ledgerOrgB = await getLedger(client, orgB.id, {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    // orgB a le même plan comptable de départ (seedDefaultChart) mais aucune
    // écriture : aucune activité d'orgA ne doit apparaître ici.
    expect(ledgerOrgB.accounts).toEqual([]);

    const trialBalanceOrgB = await getComparativeTrialBalance(client, orgB.id, {
      current: { startDate: "2026-01-01", endDate: "2026-01-31" },
      previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
    });
    expect(trialBalanceOrgB.totals.debit).toBe(0);
    expect(trialBalanceOrgB.totals.credit).toBe(0);
    expect(trialBalanceOrgB.anomalies).toEqual([]);
  });
});
