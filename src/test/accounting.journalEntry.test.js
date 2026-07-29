const { validateBalancedEntry } = require('../services/accounting/journalEntry.service');

describe('journal entries', () => {
  test('accepts a balanced debit and credit', () => {
    expect(validateBalancedEntry([
      { accountId: 1, debit: 125, credit: 0 },
      { accountId: 2, debit: 0, credit: 125 },
    ])).toHaveLength(2);
  });

  test('rejects an unbalanced entry', () => {
    expect(() => validateBalancedEntry([
      { accountId: 1, debit: 125, credit: 0 },
      { accountId: 2, debit: 0, credit: 100 },
    ])).toThrow('ACCOUNTING_ENTRY_UNBALANCED');
  });
});
