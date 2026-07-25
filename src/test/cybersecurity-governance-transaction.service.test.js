const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const policies = require('../services/business/cybersecurity-governance-transaction.service');

const evaluate = (policy, input, idempotencyKey = 'cyber-test-001') => evaluatePolicy({ policy, input, idempotencyKey });

describe('cybersecurity governance transaction policies', () => {
  test('refuse un actif sans propriétaire ni prochaine révision', async () => {
    const result = await evaluate(policies.ASSET_CREATE_POLICY, { assetNumber: 'CYB-001', name: 'API', assetType: 'application' });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.asset_governance_required');
  });

  test('autorise un actif gouverné', async () => {
    const result = await evaluate(policies.ASSET_CREATE_POLICY, { assetNumber: 'CYB-001', name: 'API', assetType: 'application', ownerUserId: 42, nextReviewAt: '2027-01-01T00:00:00Z' });
    expect(result.allowed).toBe(true);
  });

  test('refuse la vérification d’un contrôle sans résultat ni preuve', async () => {
    const result = await evaluate(policies.CONTROL_VERIFY_POLICY, { controlId: 1, nextVerificationAt: '2027-01-01T00:00:00Z', result: '', evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.control_verification_proof_required');
  });

  test('refuse l’acceptation d’une vulnérabilité sans justification', async () => {
    const result = await evaluate(policies.VULNERABILITY_TRANSITION_POLICY, { vulnerabilityId: 1, action: 'accepted' });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.acceptance_reason_required');
  });

  test('refuse un incident critique sans actifs touchés ni journal de décisions', async () => {
    const result = await evaluate(policies.INCIDENT_RECORD_POLICY, { incidentNumber: 'INC-001', title: 'Intrusion', description: 'Accès non autorisé', severity: 'critical', occurredAt: '2026-07-25T12:00:00Z', ownerUserId: 42, affectedAssets: [], decisionLog: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.major_incident_trace_required');
  });

  test('refuse la fermeture d’un incident sans cause, retour et preuve', async () => {
    const result = await evaluate(policies.INCIDENT_CLOSE_POLICY, { incidentId: 1, rootCause: '', lessonsLearned: '', evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.incident_closure_proof_required');
  });

  test('refuse une revue d’accès avec exceptions sans actions correctives', async () => {
    const result = await evaluate(policies.ACCESS_REVIEW_COMPLETE_POLICY, { reviewNumber: 'REV-001', scope: 'Administrateurs', reviewerUserId: 42, conclusion: 'Deux exceptions', nextReviewAt: '2027-01-01T00:00:00Z', evidence: ['proof'], exceptions: ['user-1'], remediationActions: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.access_review_remediation_required');
  });

  test('refuse un exercice sans conclusion ni preuve', async () => {
    const result = await evaluate(policies.EXERCISE_RECORD_POLICY, { exerciseNumber: 'EX-001', exerciseType: 'tabletop', scenario: 'Rançongiciel', ownerUserId: 42, result: 'partial', conclusion: '', evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('cybersecurity.exercise_proof_required');
  });
});
