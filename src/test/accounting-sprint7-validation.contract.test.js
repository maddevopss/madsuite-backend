const accountingService = require("../services/business/accounting.service");
const reconciliation = require("../services/business/accounting-reconciliation.service");

describe("Bloc 1 / Sprint 7 — validation complète", () => {
  test("le scénario facture de 114,98 $ demeure équilibré", () => {
    const result = accountingService.validateEntryLines([
      { accountId: 1100, debit: 114.98, credit: 0 },
      { accountId: 4000, debit: 0, credit: 100 },
      { accountId: 2100, debit: 0, credit: 5 },
      { accountId: 2110, debit: 0, credit: 9.98 },
    ]);

    expect(result.debit).toBe(114.98);
    expect(result.credit).toBe(114.98);
  });

  test("le paiement complet solde les comptes clients sans double comptabilisation", () => {
    const report = reconciliation.summarize([
      {
        source_type: "invoice",
        source_id: "INV-310",
        source_amount: "114.98",
        posted_debit: "114.98",
        posted_credit: "114.98",
        entry_count: 1,
      },
      {
        source_type: "invoice_payment",
        source_id: "PAY-310",
        source_amount: "114.98",
        posted_debit: "114.98",
        posted_credit: "114.98",
        entry_count: 1,
      },
    ]);

    expect(report).toEqual(expect.objectContaining({ checked: 2, balanced: 2, healthy: true }));
  });

  test("un écart d’un cent est signalé", () => {
    const report = reconciliation.summarize([
      {
        source_type: "expense",
        source_id: "EXP-310",
        source_amount: "57.49",
        posted_debit: "57.48",
        posted_credit: "57.48",
        entry_count: 1,
      },
    ]);

    expect(report.healthy).toBe(false);
  });
});
