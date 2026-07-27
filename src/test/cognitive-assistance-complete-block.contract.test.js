const { evaluateAssistanceClosure } = require('../services/business/cognitive-assistance-closure.service');

describe('cognitive assistance complete block', () => {
  test('blocks closure when human confirmation or evidence is missing', () => {
    const result = evaluateAssistanceClosure({
      authorizedUseCases: 1,
      uncontrolledContextCount: 0,
      unexplainedRecommendations: 0,
      pendingHumanConfirmations: 1,
      missingAuditEvidence: 1,
      failedEvaluations: 0,
      openDriftAlerts: 0,
      costOverruns: 0,
      stopMechanismVerified: true,
      evidence: [],
      approvedBy: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['human_confirmations', 'audit_evidence', 'closure_evidence', 'human_approval']));
  });

  test('allows closure only when assistance remains explainable, controlled and human-approved', () => {
    const result = evaluateAssistanceClosure({
      authorizedUseCases: 3,
      uncontrolledContextCount: 0,
      unexplainedRecommendations: 0,
      pendingHumanConfirmations: 0,
      missingAuditEvidence: 0,
      failedEvaluations: 0,
      openDriftAlerts: 0,
      costOverruns: 0,
      stopMechanismVerified: true,
      evidence: [{ type: 'review', id: 'REV-1' }],
      approvedBy: 42,
    });
    expect(result).toMatchObject({ eligible: true, status: 'approved', blockers: [] });
  });
});