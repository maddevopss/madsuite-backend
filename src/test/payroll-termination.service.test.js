const { buildFinalPay, buildRoePayload } = require('../services/business/payroll-termination.service');
describe('payroll termination', () => {
  test('additionne la paie finale', () => expect(buildFinalPay({ regular: 1000, vacation: 120, severance: 500, other: 30 }).total).toBe(1650));
  test('construit le relevé demploi', () => expect(buildRoePayload({ employeeNumber: 'E-1', lastDayWorked: '2026-07-15', finalPayDate: '2026-07-22', reasonCode: 'A00' }).reasonCode).toBe('A00'));
  test('refuse un montant négatif', () => expect(() => buildFinalPay({ regular: -1 })).toThrow());
});
