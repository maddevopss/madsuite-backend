const { buildRemittance, isOverdue } = require('../services/business/payroll-remittance.service');
describe('payroll remittances', () => {
  test('additionne les parts employé et employeur', () => expect(buildRemittance({ employeeAmount: 125.55, employerAmount: 80.45, dueDate: '2026-08-15' }).totalAmount).toBe(206));
  test('détecte une remise en retard', () => expect(isOverdue({ status: 'approved', dueDate: '2026-07-01' }, '2026-07-27')).toBe(true));
  test('une remise payée nest pas en retard', () => expect(isOverdue({ status: 'paid', dueDate: '2026-07-01' }, '2026-07-27')).toBe(false));
});
