const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/organizational-governance-transaction.service');

const key = 'governance-test-key';

describe('organizational governance transaction policies', () => {
  test('refuse une délégation sans preuve', async () => {
    const result = await evaluatePolicy('governance.delegation.create@1', { input: { delegatorUserId: 1, delegateUserId: 2, authorityType: 'financial', reason: 'Absence', startsAt: '2026-08-01', endsAt: '2026-08-31', scope: ['payments'], evidence: [] }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.delegation_proof_required');
  });

  test('refuse une réunion sans quorum', async () => {
    const result = await evaluatePolicy('governance.committee.meeting.complete@1', { input: { meetingId: 1, quorumMet: false, minutes: 'Procès-verbal', attendees: [1], agenda: ['Point'], evidence: ['preuve'] }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.meeting_quorum_required');
  });

  test('refuse une décision sans justification', async () => {
    const result = await evaluatePolicy('governance.decision.create@1', { input: { decisionNumber: 'DEC-1', title: 'Décision', context: 'Contexte', analysis: 'Analyse', decisionText: 'Décider', authorUserId: 1, evidence: ['preuve'] }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.decision_fields_required');
  });

  test('refuse l’auto-approbation', async () => {
    const result = await evaluatePolicy('governance.decision.approve@1', { input: { decisionId: 1, authorUserId: 2, approverUserId: 2, approvalReason: 'OK', authorityValid: true }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.decision_independent_approval_required');
  });

  test('refuse une approbation avec conflit actif', async () => {
    const result = await evaluatePolicy('governance.decision.approve@1', { input: { decisionId: 1, authorUserId: 1, approverUserId: 2, approvalReason: 'OK', authorityValid: true, activeConflict: true }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.decision_conflict_blocked');
  });

  test('refuse une politique sans preuve d’approbation', async () => {
    const result = await evaluatePolicy('governance.policy.publish@1', { input: { policyId: 1, ownerUserId: 1, approvedByUserId: 2, effectiveFrom: '2026-08-01', reviewDueAt: '2027-08-01', approvalEvidence: [] }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.policy_approval_evidence_required');
  });

  test('refuse une autorité au-delà de la limite', async () => {
    const result = await evaluatePolicy('governance.authority.validate@1', { input: { actorUserId: 2, authorityType: 'financial', requestedAmount: 25000, financialLimit: 10000, withinScope: true, withinPeriod: true }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('governance.authority_limit_exceeded');
  });
});