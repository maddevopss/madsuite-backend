const service = require('../services/business/accounting-close-readiness.service');

describe('accounting close readiness', () => {
  test('blocks close when a required task is incomplete', () => {
    const result = service.evaluateReadiness([
      { task_code: 'trial_balance_balanced', status: 'completed', blocking: true },
      { task_code: 'bank_reconciled', status: 'pending', blocking: true },
    ]);
    expect(result.ready).toBe(false);
    expect(result.blockingIncomplete).toEqual(['bank_reconciled']);
  });

  test('accepts explicit waiver as evidence-backed completion', () => {
    expect(service.evaluateReadiness([
      { task_code: 'depreciation_posted', status: 'waived', blocking: true },
    ]).ready).toBe(true);
  });
});
