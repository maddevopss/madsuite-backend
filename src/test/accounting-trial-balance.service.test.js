const {
  normalizePeriod,
  buildComparativeRows,
  totals,
  getComparativeTrialBalance,
} = require("../services/business/accounting-trial-balance.service");

describe("accounting-trial-balance.service", () => {
  test("refuse une période incomplète ou inversée", () => {
    expect(() => normalizePeriod("période", {})).toThrow("obligatoires");
    expect(() => normalizePeriod("période", { startDate: "2026-02-01", endDate: "2026-01-01" }))
      .toThrow("précéder");
  });

  test("calcule les écarts entre deux périodes", () => {
    const rows = buildComparativeRows(
      [{ account_id: 1, code: "1010", name: "Banque", account_type: "asset", is_active: true, debit: "150.00", credit: "25.00", balance: "125.00" }],
      [{ account_id: 1, code: "1010", name: "Banque", account_type: "asset", is_active: true, debit: "100.00", credit: "10.00", balance: "90.00" }],
    );

    expect(rows[0].current).toEqual({ debit: 150, credit: 25, balance: 125 });
    expect(rows[0].previous).toEqual({ debit: 100, credit: 10, balance: 90 });
    expect(rows[0].variance).toEqual({ debit: 50, credit: 15, balance: 35 });
  });

  test("additionne les totaux courants au cent près", () => {
    expect(totals([
      { current: { debit: 100.1, credit: 20.05, balance: 80.05 } },
      { current: { debit: 20.2, credit: 100.25, balance: -80.05 } },
    ])).toEqual({ debit: 120.3, credit: 120.3, balance: 0 });
  });

  test("retourne l’équilibre et les écritures fautives", async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [
          { account_id: 1, code: "1010", name: "Banque", account_type: "asset", is_active: true, debit: "100.00", credit: "0.00", balance: "100.00" },
          { account_id: 2, code: "4000", name: "Revenus", account_type: "revenue", is_active: true, debit: "0.00", credit: "100.00", balance: "-100.00" },
        ] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { anomaly_type: "inactive_account_used", entry_id: 44, entry_number: "GEN-44", entry_date: "2026-01-15", source_type: "invoice", source_id: "9", debit: "100.00", credit: "100.00" },
        ] }),
    };

    const result = await getComparativeTrialBalance(db, 10, {
      current: { startDate: "2026-01-01", endDate: "2026-01-31" },
      previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
    });

    expect(result.isBalanced).toBe(true);
    expect(result.totals).toEqual({ debit: 100, credit: 100, balance: 0 });
    expect(result.anomalies[0]).toMatchObject({
      type: "inactive_account_used",
      entryId: 44,
      source: { type: "invoice", id: "9" },
    });
    expect(db.query.mock.calls[0][1]).toEqual([10, "2026-01-01", "2026-01-31"]);
  });
});
