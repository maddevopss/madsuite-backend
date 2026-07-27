const { buildYearEndSlip } = require('../services/business/payroll-year-end.service');
describe('payroll year end', () => {
  test('construit un T4 avec empreinte', () => { const slip = buildYearEndSlip({ slipType: 'T4', earnings: 50000, tax: 9000, pension: 2500, insurance: 800 }); expect(slip.boxes.earnings).toBe(50000); expect(slip.sourceHash).toHaveLength(64); });
  test('refuse un type inconnu', () => expect(() => buildYearEndSlip({ slipType: 'X' })).toThrow());
  test('refuse un montant négatif', () => expect(() => buildYearEndSlip({ slipType: 'RL1', earnings: -1 })).toThrow());
});
