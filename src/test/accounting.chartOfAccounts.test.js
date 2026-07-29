const { normalizeAccount, NORMAL_BALANCE_BY_TYPE } = require('../services/accounting/chartOfAccounts.service');

describe('chart of accounts', () => {
  test.each([
    ['asset', 'debit'], ['expense', 'debit'], ['liability', 'credit'], ['equity', 'credit'], ['revenue', 'credit'],
  ])('assigns %s accounts a %s normal balance', (accountType, expected) => {
    expect(normalizeAccount({ code: '1000', name: 'Compte', accountType }).normalBalance).toBe(expected);
    expect(NORMAL_BALANCE_BY_TYPE[accountType]).toBe(expected);
  });

  test('rejects incomplete and unknown accounts', () => {
    expect(() => normalizeAccount({ name: 'Sans code', accountType: 'asset' })).toThrow('ACCOUNT_CODE_AND_NAME_REQUIRED');
    expect(() => normalizeAccount({ code: '1', name: 'Inconnu', accountType: 'other' })).toThrow('ACCOUNT_TYPE_INVALID');
  });
});
