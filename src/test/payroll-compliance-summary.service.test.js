const { buildComplianceSummary } = require('../services/business/payroll-compliance-summary.service');

describe('payroll compliance summary', () => {
  test('is ready when no blocker exists', () => {
    expect(buildComplianceSummary({})).toMatchObject({ status: 'ready', blockers: 0 });
  });

  test('counts compliance blockers', () => {
    const result = buildComplianceSummary({
      vacationBanks: [{ availableAmount: -25 }],
      terminations: [{ status: 'draft' }],
      slips: [{ status: 'draft' }],
    });
    expect(result).toMatchObject({ status: 'attention_required', blockers: 3 });
  });
});
