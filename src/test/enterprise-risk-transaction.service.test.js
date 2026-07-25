const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  RISK_CREATE_POLICY,
  RISK_ASSESSMENT_POLICY,
  RISK_CONTROL_TRANSITION_POLICY,
  RISK_TREATMENT_TRANSITION_POLICY,
  RISK_REVIEW_TRANSITION_POLICY,
  RISK_INCIDENT_POLICY,
  calculateRiskScore,
  calculateResidualScore,
} = require('../services/business/enterprise-risk-transaction.service');

describe('enterprise risk transactional core', () => {
  test('calcule un niveau brut reproductible', () => {
    expect(calculateRiskScore(4, 5)).toBe(20);
    expect(calculateRiskScore(0, 5)).toBeNull();
  });

  test('calcule le risque résiduel selon l’efficacité des contrôles', () => {
    expect(calculateResidualScore(20, 25)).toBe(15);
    expect(calculateResidualScore(20, 101)).toBeNull();
  });

  test('refuse un risque sans propriétaire', async () => {
    const decision = await evaluatePolicy({ policy: RISK_CREATE_POLICY, input: { riskNumber: 'R-1', category: 'operational', title: 'Risque', description: 'Description', likelihood: 3, impact: 4 }, idempotencyKey: 'risk-create-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.owner_required');
  });

  test('refuse une probabilité hors échelle', async () => {
    const decision = await evaluatePolicy({ policy: RISK_CREATE_POLICY, input: { riskNumber: 'R-2', category: 'financial', title: 'Risque', description: 'Description', ownerUserId: 1, likelihood: 6, impact: 4 }, idempotencyKey: 'risk-create-002' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.assessment_level_invalid');
  });

  test('retourne le score lors de la création permise', async () => {
    const decision = await evaluatePolicy({ policy: RISK_CREATE_POLICY, input: { riskNumber: 'R-3', category: 'quality', title: 'Risque', description: 'Description', ownerUserId: 1, likelihood: 3, impact: 5 }, idempotencyKey: 'risk-create-003' });
    expect(decision.allowed).toBe(true);
    expect(decision.score).toBe(15);
  });

  test('refuse une évaluation sans conclusion', async () => {
    const decision = await evaluatePolicy({ policy: RISK_ASSESSMENT_POLICY, input: { riskId: 1, likelihood: 3, impact: 4, controlEffectiveness: 25 }, idempotencyKey: 'risk-assess-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.assessment_conclusion_required');
  });

  test('refuse l’activation d’un contrôle sans preuve', async () => {
    const decision = await evaluatePolicy({ policy: RISK_CONTROL_TRANSITION_POLICY, input: { action: 'active', verificationEvidence: [] }, idempotencyKey: 'risk-control-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.control_evidence_required');
  });

  test('refuse un traitement implanté sans preuve', async () => {
    const decision = await evaluatePolicy({ policy: RISK_TREATMENT_TRANSITION_POLICY, input: { action: 'implemented', evidence: [] }, idempotencyKey: 'risk-treat-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.treatment_evidence_required');
  });

  test('refuse une révision approuvée sans conclusion et preuve', async () => {
    const decision = await evaluatePolicy({ policy: RISK_REVIEW_TRANSITION_POLICY, input: { action: 'approved', evidence: [], nextReviewAt: '2027-01-01' }, idempotencyKey: 'risk-review-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.review_proof_required');
  });

  test('refuse un incident critique sans preuve', async () => {
    const decision = await evaluatePolicy({ policy: RISK_INCIDENT_POLICY, input: { incidentNumber: 'INC-1', sourceType: 'quality', title: 'Incident', description: 'Description', severity: 'critical', evidence: [] }, idempotencyKey: 'risk-incident-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('risk.critical_incident_evidence_required');
  });
});
