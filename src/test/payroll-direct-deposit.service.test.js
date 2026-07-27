const { buildPaymentBatch } = require('../services/business/payroll-direct-deposit.service');
describe('payroll direct deposit', () => {
  test('calcule le lot et son empreinte', () => { const batch = buildPaymentBatch([{ employeeId: 1, amount: 100.25 }, { employeeId: 2, amount: 50 }]); expect(batch.totalAmount).toBe(150.25); expect(batch.paymentCount).toBe(2); expect(batch.fileHash).toHaveLength(64); });
  test('refuse un lot vide', () => expect(() => buildPaymentBatch([])).toThrow());
  test('refuse un montant nul', () => expect(() => buildPaymentBatch([{ employeeId: 1, amount: 0 }])).toThrow());
});
