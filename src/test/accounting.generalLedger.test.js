const { runningBalance } = require('../services/accounting/generalLedger.service');

describe('general ledger', () => {
  test('computes debit-normal balances', () => {
    expect(runningBalance([{ debit: 100, credit: 0 }, { debit: 0, credit: 30 }], 'debit').map((x) => x.balance)).toEqual([100, 70]);
  });
  test('computes credit-normal balances', () => {
    expect(runningBalance([{ debit: 0, credit: 100 }, { debit: 25, credit: 0 }], 'credit').map((x) => x.balance)).toEqual([100, 75]);
  });
});
