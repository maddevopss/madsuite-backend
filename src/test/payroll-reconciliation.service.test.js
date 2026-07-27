const { reconcilePayroll } = require('../services/business/payroll-reconciliation.service');

describe('payroll reconciliation', () => {
  test('is balanced within tolerance', () => {
    expect(reconcilePayroll({ expectedNet: 1000, depositedNet: 1000.005 }).status).toBe('balanced');
  });

  test('blocks a material variance', () => {
    const result = reconcilePayroll({ expectedNet: 1000, depositedNet: 990 });
    expect(result.status).toBe('blocked');
    expect(result.findings[0].code).toBe('NET_DEPOSIT_VARIANCE');
  });
});
