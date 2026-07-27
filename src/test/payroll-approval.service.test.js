const { evaluateApproval } = require('../services/business/payroll-approval.service');

describe('payroll approval controls', () => {
  test('requires two distinct approvers', () => {
    const result = evaluateApproval({ createdBy: 1, decisions: [{ status: 'approved', decidedBy: 2 }, { status: 'approved', decidedBy: 3 }] });
    expect(result.ready).toBe(true);
  });

  test('blocks self approval', () => {
    const result = evaluateApproval({ createdBy: 1, decisions: [{ status: 'approved', decidedBy: 1 }, { status: 'approved', decidedBy: 2 }] });
    expect(result.ready).toBe(false);
    expect(result.selfApproved).toBe(true);
  });
});
