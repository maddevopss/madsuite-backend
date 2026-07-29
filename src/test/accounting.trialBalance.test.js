const { buildTrialBalance } = require('../services/accounting/trialBalance.service');

describe('trial balance', () => {
  test('reports matching debit and credit totals', () => {
    const result = buildTrialBalance([
      { account_id: 1, code: '1000', name: 'Encaisse', debit: 250, credit: 0 },
      { account_id: 2, code: '4000', name: 'Revenus', debit: 0, credit: 250 },
    ]);
    expect(result).toMatchObject({ totalDebit: 250, totalCredit: 250, balanced: true });
  });
});
