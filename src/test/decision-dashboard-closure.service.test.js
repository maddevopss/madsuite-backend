const { evaluateDecisionDashboardClosure } = require('../services/business/decision-dashboard-closure.service');

describe('decision dashboard closure', () => {
  const complete = {
    financialHealth: { score: 82 },
    cashflowOutlook: { horizonDays: 90 },
    operationalScorecard: { status: 'stable' },
    riskSummary: { critical: 0 },
    unresolvedAlerts: 0,
    evidence: [{ type: 'snapshot', id: 1 }],
    approvedBy: 42,
  };

  test('allows publication when every source and approval is present', () => {
    expect(evaluateDecisionDashboardClosure(complete)).toMatchObject({ allowed: true, blockingReasons: [] });
  });

  test('blocks publication when alerts remain unresolved', () => {
    const result = evaluateDecisionDashboardClosure({ ...complete, unresolvedAlerts: 2 });
    expect(result.allowed).toBe(false);
    expect(result.blockingReasons).toContain('alerts_resolved');
  });

  test('blocks publication without human approval and evidence', () => {
    const result = evaluateDecisionDashboardClosure({ ...complete, evidence: [], approvedBy: null });
    expect(result.blockingReasons).toEqual(expect.arrayContaining(['evidence_present', 'human_approval_present']));
  });
});
