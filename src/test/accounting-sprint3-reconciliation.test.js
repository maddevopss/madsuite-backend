const reconciliation = require("../services/business/accounting-reconciliation.service");

describe("Bloc 1 / Sprint 3 — réconciliation comptable", () => {
  test("déclare sain un ensemble à entrée unique, équilibré et concordant", () => {
    expect(reconciliation.summarize([
      {
        source_type: "invoice",
        source_id: "42",
        source_amount: "114.98",
        posted_debit: "114.98",
        posted_credit: "114.98",
        entry_count: 1,
      },
    ])).toEqual(expect.objectContaining({ checked: 1, balanced: 1, healthy: true, anomalies: [] }));
  });

  test("détecte une double comptabilisation", () => {
    const report = reconciliation.summarize([
      {
        source_type: "payment",
        source_id: "77",
        source_amount: "250.00",
        posted_debit: "500.00",
        posted_credit: "500.00",
        entry_count: 2,
      },
    ]);

    expect(report.healthy).toBe(false);
    expect(report.anomalies).toHaveLength(1);
  });

  test("détecte un écart entre la source et l’écriture", () => {
    const report = reconciliation.summarize([
      {
        source_type: "expense",
        source_id: "9",
        source_amount: "100.00",
        posted_debit: "99.99",
        posted_credit: "99.99",
        entry_count: 1,
      },
    ]);

    expect(report.healthy).toBe(false);
  });
});
