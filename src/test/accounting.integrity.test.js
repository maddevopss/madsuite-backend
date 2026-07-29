const { inspectAccountingIntegrity } = require('../services/accounting/accountingIntegrity.service');

describe('accounting integrity', () => {
  test('detects unbalanced and incomplete entries', () => {
    const result = inspectAccountingIntegrity({
      accounts: [{ id: 1 }],
      entries: [{ id: 10 }],
      lines: [{ id: 100, entry_id: 10, account_id: 1, debit: 50, credit: 0 }],
    });
    expect(result.healthy).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['ENTRY_TOO_SHORT', 'ENTRY_UNBALANCED']));
  });
});
