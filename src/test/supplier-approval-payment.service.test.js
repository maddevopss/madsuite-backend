const { computeBatchTotals } = require('../services/business/supplier-approval-payment.service');

describe('supplier approval and payment batches', () => {
  test('calcule les montants du lot côté serveur', () => {
    const result = computeBatchTotals([
      { billId: 1, requestedAmount: 100, earlyPaymentDiscount: 2, withholdingAmount: 3 },
      { billId: 2, requestedAmount: 50, earlyPaymentDiscount: 0, withholdingAmount: 5 },
    ]);
    expect(result).toMatchObject({ grossTotal: 150, discountTotal: 2, withholdingTotal: 8, netTotal: 140 });
    expect(result.lines.map((line) => line.payableAmount)).toEqual([95, 45]);
  });

  test('refuse un montant net négatif', () => {
    expect(() => computeBatchTotals([{ requestedAmount: 10, earlyPaymentDiscount: 11 }])).toThrow('supplier.invalid_payment_amounts');
  });
});
