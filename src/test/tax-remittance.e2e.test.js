// Preuve d'exécution réelle pour le domaine 1.I (taxes avancées), deuxième
// micro-bloc : périodes fiscales et rapport de remise. Le rapport agrège
// réellement les montants comptabilisés (taxe perçue sur une vente, taxe
// récupérable sur une dépense) et le dépôt fige le résultat en instantané,
// insensible à toute écriture publiée après coup — jamais de recalcul
// silencieux de l'historique.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { seedDefaultChart, createEntry, postEntry } = require("../services/business/accounting.service");
const { createTaxCode, activateTaxCode } = require("../services/business/tax-codes.service");
const {
  createTaxFilingPeriod,
  getTaxRemittanceReport,
  fileTaxPeriod,
  listTaxFilingPeriods,
} = require("../services/business/tax-remittance.service");

async function getAccountByCode(client, organisationId, code) {
  const { rows } = await client.query(`SELECT * FROM accounting_accounts WHERE organisation_id=$1 AND code=$2`, [organisationId, code]);
  return rows[0];
}

describe("Périodes fiscales et rapport de remise (domaine 1.I)", () => {
  let client;
  let orgA;
  let orgB;
  let bank;
  let revenue;
  let expense;
  let taxPayable;
  let taxReceivable;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Remise Taxes E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Remise Taxes E2E Org B" });
    await seedDefaultChart(client, orgA.id);
    bank = await getAccountByCode(client, orgA.id, "1010");
    revenue = await getAccountByCode(client, orgA.id, "4000");
    expense = await getAccountByCode(client, orgA.id, "6900");
    taxPayable = await getAccountByCode(client, orgA.id, "2100");
    taxReceivable = await getAccountByCode(client, orgA.id, "1300");

    const tps = await createTaxCode(client, orgA.id, {
      code: "TPS", name: "TPS perçue 5%", rate: 0.05, taxType: "collected", accountId: taxPayable.id, effectiveFrom: "2026-01-01",
    });
    await activateTaxCode(client, orgA.id, tps.id, null);
    const tpsItc = await createTaxCode(client, orgA.id, {
      code: "TPS-ITC", name: "TPS récupérable 5%", rate: 0.05, taxType: "recoverable", accountId: taxReceivable.id, effectiveFrom: "2026-01-01",
    });
    await activateTaxCode(client, orgA.id, tpsItc.id, null);
  });

  afterAll(() => {
    client.release();
  });

  test("le rapport agrège réellement la taxe perçue et récupérable comptabilisée dans la période", async () => {
    // Vente : 1000$ de revenu + 50$ de TPS perçue, encaissés au compte bancaire.
    const sale = await createEntry(client, orgA.id, null, {
      entryDate: "2026-03-10",
      description: "Vente avec TPS",
      lines: [
        { accountId: bank.id, debit: 1050, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 1000 },
        { accountId: taxPayable.id, debit: 0, credit: 50 },
      ],
    });
    await postEntry(client, orgA.id, sale.id);

    // Dépense : 200$ de charge + 10$ de TPS récupérable, payés depuis la banque.
    const purchase = await createEntry(client, orgA.id, null, {
      entryDate: "2026-03-15",
      description: "Dépense avec TPS récupérable",
      lines: [
        { accountId: expense.id, debit: 200, credit: 0 },
        { accountId: taxReceivable.id, debit: 10, credit: 0 },
        { accountId: bank.id, debit: 0, credit: 210 },
      ],
    });
    await postEntry(client, orgA.id, purchase.id);

    const period = await createTaxFilingPeriod(client, orgA.id, {
      frequency: "quarterly", periodStart: "2026-01-01", periodEnd: "2026-03-31", createdBy: null,
    });
    expect(period.status).toBe("open");

    const { report } = await getTaxRemittanceReport(client, orgA.id, period.id);
    expect(report.totalCollected).toBe(50);
    expect(report.totalRecoverable).toBe(10);
    expect(report.netAmount).toBe(40);
    expect(report.owesGovernment).toBe(true);

    const collectedRow = report.byCode.find((row) => row.code === "TPS");
    expect(collectedRow.collectedAmount).toBe(50);
    const recoverableRow = report.byCode.find((row) => row.code === "TPS-ITC");
    expect(recoverableRow.recoverableAmount).toBe(10);
  });

  test("le dépôt fige le rapport : une écriture publiée après coup ne modifie jamais le montant déposé", async () => {
    const period = await createTaxFilingPeriod(client, orgA.id, {
      frequency: "monthly", periodStart: "2026-04-01", periodEnd: "2026-04-30", createdBy: null,
    });

    const sale = await createEntry(client, orgA.id, null, {
      entryDate: "2026-04-05",
      description: "Vente avril",
      lines: [
        { accountId: bank.id, debit: 105, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 100 },
        { accountId: taxPayable.id, debit: 0, credit: 5 },
      ],
    });
    await postEntry(client, orgA.id, sale.id);

    const filed = await fileTaxPeriod(client, orgA.id, period.id, null);
    expect(filed.duplicate).toBe(false);
    expect(Number(filed.period.net_amount)).toBe(5);
    expect(filed.period.status).toBe("filed");

    // Une nouvelle vente datée dans la même période, publiée APRÈS le dépôt.
    const lateSale = await createEntry(client, orgA.id, null, {
      entryDate: "2026-04-20",
      description: "Vente tardive avril (après dépôt)",
      lines: [
        { accountId: bank.id, debit: 210, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 200 },
        { accountId: taxPayable.id, debit: 0, credit: 10 },
      ],
    });
    await postEntry(client, orgA.id, lateSale.id);

    const { period: fetchedPeriod, report } = await getTaxRemittanceReport(client, orgA.id, period.id);
    expect(fetchedPeriod.status).toBe("filed");
    // Le rapport reste figé à 5$, PAS 15$ : la vente tardive n'affecte pas
    // un instantané déjà déposé.
    expect(report.netAmount).toBe(5);

    // Redéposer est idempotent : aucun recalcul, même résultat retourné.
    const refiled = await fileTaxPeriod(client, orgA.id, period.id, null);
    expect(refiled.duplicate).toBe(true);
    expect(Number(refiled.period.net_amount)).toBe(5);
  });

  test("une période fiscale ne peut pas chevaucher une période existante", async () => {
    await expect(
      createTaxFilingPeriod(client, orgA.id, { frequency: "monthly", periodStart: "2026-03-15", periodEnd: "2026-04-15" }),
    ).rejects.toThrow("chevauche");
  });

  test("isolation stricte entre deux organisations", async () => {
    const periodsOrgB = await listTaxFilingPeriods(client, orgB.id);
    expect(periodsOrgB).toEqual([]);
  });
});
