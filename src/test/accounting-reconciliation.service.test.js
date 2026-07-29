const {
  money,
  classify,
  summarize,
  reconcilePostedSources,
} = require("../services/business/accounting-reconciliation.service");

describe("accounting reconciliation", () => {
  test("normalise les montants à deux décimales", () => {
    expect(money("125.505")).toBe(125.5);
  });

  test.each([
    [{ source_amount: 115, posted_debit: 115, posted_credit: 115, entry_count: 1 }, "matched"],
    [{ source_amount: 115, posted_debit: 0, posted_credit: 0, entry_count: 0 }, "missing_entry"],
    [{ source_amount: 115, posted_debit: 115, posted_credit: 115, entry_count: 2 }, "duplicate_entries"],
    [{ source_amount: 115, posted_debit: 115, posted_credit: 100, entry_count: 1 }, "unbalanced_entry"],
    [{ source_amount: 115, posted_debit: 110, posted_credit: 110, entry_count: 1 }, "amount_mismatch"],
  ])("classe correctement une preuve comptable", (row, expected) => {
    expect(classify({ source_type: "invoice", source_id: "42", ...row }).status).toBe(expected);
  });

  test("inclut les écritures orphelines dans le diagnostic", () => {
    const result = summarize([
      {
        source_type: "invoice",
        source_id: "42",
        source_amount: 115,
        posted_debit: 115,
        posted_credit: 115,
        entry_count: 1,
      },
    ], [{ id: 99, source_type: "expense", source_id: "77" }]);

    expect(result.healthy).toBe(false);
    expect(result.counts).toMatchObject({ matched: 1, orphanEntries: 1 });
  });

  test("normalise puis agrège les écritures avant de joindre les montants sources", async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            source_type: "invoice",
            source_id: "42",
            source_amount: "115.00",
            posted_debit: "115.00",
            posted_credit: "115.00",
            entry_count: 1,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const result = await reconcilePostedSources(db, 7);
    const reconciliationSql = db.query.mock.calls[0][0];

    expect(result.healthy).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(reconciliationSql).toContain("accounting_entries_normalized AS");
    expect(reconciliationSql).toContain("accounting_totals AS");
    expect(reconciliationSql).toContain("FULL OUTER JOIN accounting_totals");
    expect(reconciliationSql).toContain("le.reference_type AS source_type");
    expect(db.query.mock.calls[0][1]).toEqual([7]);
    expect(db.query.mock.calls[1][0]).toContain("le.id IS NULL");
    expect(db.query.mock.calls[1][1]).toEqual([7]);
  });

  test("refuse un rapprochement sans organisation", async () => {
    await expect(reconcilePostedSources({ query: jest.fn() }, null))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});