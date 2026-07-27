const {
  groupAccounts,
  buildStatements,
  buildComparativeStatements,
  getComparativeStatements,
} = require("../services/business/accounting-statements-comparative.service");

describe("accounting-statements-comparative.service", () => {
  test("regroupe les comptes et conserve les écritures sources", () => {
    const accounts = groupAccounts([
      { account_id: 1, code: "1010", name: "Banque", account_type: "asset", entry_id: 10, entry_number: "GEN-10", entry_date: "2026-01-02", source_type: "payment", source_id: "5", line_id: 100, debit: "250.00", credit: "0.00" },
      { account_id: 1, code: "1010", name: "Banque", account_type: "asset", entry_id: 11, entry_number: "GEN-11", entry_date: "2026-01-03", source_type: "expense", source_id: "6", line_id: 101, debit: "0.00", credit: "50.00" },
    ]);

    expect(accounts[0]).toMatchObject({ debit: 250, credit: 50, balance: 200 });
    expect(accounts[0].sources).toHaveLength(2);
    expect(accounts[0].sources[0].source).toEqual({ type: "payment", id: "5" });
  });

  test("calcule l’état des résultats, le bilan et les flux", () => {
    const statements = buildStatements([
      { accountId: 1, code: "1010", name: "Banque", accountType: "asset", balance: 80, sources: [] },
      { accountId: 2, code: "1500", name: "Équipement", accountType: "asset", balance: 20, sources: [] },
      { accountId: 3, code: "2000", name: "Dette", accountType: "liability", balance: -40, sources: [] },
      { accountId: 4, code: "3000", name: "Capital", accountType: "equity", balance: -20, sources: [] },
      { accountId: 5, code: "4000", name: "Revenus", accountType: "revenue", balance: -100, sources: [] },
      { accountId: 6, code: "5000", name: "Charges", accountType: "expense", balance: 40, sources: [] },
    ]);

    expect(statements.incomeStatement).toMatchObject({ revenue: 100, expenses: 40, netIncome: 60 });
    expect(statements.balanceSheet).toMatchObject({ assets: 100, liabilities: 40, equity: 20, retainedEarnings: 60, isBalanced: true });
    expect(statements.cashFlow.netChange).toBe(80);
  });

  test("produit les écarts comparatifs", () => {
    const current = buildStatements([
      { accountId: 1, code: "4000", name: "Revenus", accountType: "revenue", balance: -120, sources: [] },
      { accountId: 2, code: "5000", name: "Charges", accountType: "expense", balance: 50, sources: [] },
    ]);
    const previous = buildStatements([
      { accountId: 1, code: "4000", name: "Revenus", accountType: "revenue", balance: -100, sources: [] },
      { accountId: 2, code: "5000", name: "Charges", accountType: "expense", balance: 40, sources: [] },
    ]);

    const comparative = buildComparativeStatements(current, previous);
    expect(comparative.incomeStatement.revenue).toEqual({ current: 120, previous: 100, variance: 20 });
    expect(comparative.incomeStatement.netIncome).toEqual({ current: 70, previous: 60, variance: 10 });
  });

  test("isole toutes les requêtes par organisation", async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const result = await getComparativeStatements(db, 77, {
      current: { startDate: "2026-01-01", endDate: "2026-01-31" },
      previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
    });

    expect(result.periods.current.startDate).toBe("2026-01-01");
    expect(db.query.mock.calls[0][1]).toEqual([77, "2026-01-01", "2026-01-31"]);
    expect(db.query.mock.calls[1][1]).toEqual([77, "2025-12-01", "2025-12-31"]);
  });
});
