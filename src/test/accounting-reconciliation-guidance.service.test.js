const {
  classify,
  normalizeOrphan,
  remediationFor,
  summarize,
} = require("../services/business/accounting-reconciliation.service");

describe("accounting reconciliation guidance", () => {
  test("recommande un ajustement lorsqu’une écriture manque", () => {
    const result = classify({
      source_type: "invoice",
      source_id: "41",
      source_amount: "115.00",
      posted_debit: "0",
      posted_credit: "0",
      entry_count: 0,
      entry_ids: [],
    });

    expect(result.status).toBe("missing_entry");
    expect(result.remediation).toMatchObject({
      severity: "error",
      action: "create_adjustment",
    });
  });

  test("recommande une révision et un renversement en cas de doublon", () => {
    const result = classify({
      source_type: "invoice_payment",
      source_id: "99",
      source_amount: "250.00",
      posted_debit: "500.00",
      posted_credit: "500.00",
      entry_count: 2,
      entry_ids: [12, 13],
    });

    expect(result.status).toBe("duplicate_entries");
    expect(result.entryIds).toEqual([12, 13]);
    expect(result.remediation.action).toBe("review_and_reverse");
  });

  test("conserve la décision humaine comme autorité finale", () => {
    const result = summarize([
      {
        source_type: "expense",
        source_id: "7",
        source_amount: "100.00",
        posted_debit: "95.00",
        posted_credit: "95.00",
        entry_count: 1,
        entry_ids: [44],
      },
    ]);

    expect(result.healthy).toBe(false);
    expect(result.requiresHumanDecision).toBe(true);
    expect(result.anomalies[0].remediation.action).toBe("create_adjustment");
  });

  test("normalise une écriture orpheline sans la corriger automatiquement", () => {
    expect(normalizeOrphan({
      id: "88",
      entry_number: "VEN-FAC-88",
      entry_date: "2026-07-28",
      source_type: "invoice",
      source_id: "88",
    })).toMatchObject({
      id: 88,
      status: "orphan_entry",
      remediation: {
        action: "review_and_reverse",
      },
    });
  });

  test("retourne une révision manuelle pour un état inconnu", () => {
    expect(remediationFor("future_status")).toMatchObject({
      action: "manual_review",
      severity: "warning",
    });
  });
});
