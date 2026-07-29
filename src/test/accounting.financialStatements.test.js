const { buildFinancialStatements } = require('../services/accounting/financialStatements.service');

describe('financial statements', () => {
  test('builds income statement and balanced balance sheet', () => {
    const result = buildFinancialStatements([
      { account_type: 'asset', debit: 150, credit: 0 },
      { account_type: 'liability', debit: 0, credit: 50 },
      { account_type: 'equity', debit: 0, credit: 40 },
      { account_type: 'revenue', debit: 0, credit: 100 },
      { account_type: 'expense', debit: 40, credit: 0 },
    ]);
    expect(result.incomeStatement.netIncome).toBe(60);
    expect(result.balanceSheet).toMatchObject({ assets: 150, liabilities: 50, equity: 100, balanced: true });
  });
});
