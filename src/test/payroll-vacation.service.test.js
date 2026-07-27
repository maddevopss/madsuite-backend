const { accrueVacation, availableVacation } = require('../services/business/payroll-vacation.service');
describe('payroll vacation', () => {
  test('calcule 4 % du salaire brut', () => expect(accrueVacation(1000, 4)).toBe(40));
  test('calcule le solde disponible', () => expect(availableVacation(500, 125.25)).toBe(374.75));
  test('refuse un salaire négatif', () => expect(() => accrueVacation(-1, 4)).toThrow());
});
