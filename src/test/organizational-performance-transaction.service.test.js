const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  OBJECTIVE_CREATE_POLICY,
  OBJECTIVE_APPROVE_POLICY,
  INDICATOR_CREATE_POLICY,
  MEASUREMENT_RECORD_POLICY,
  REVIEW_COMPLETE_POLICY,
  IMPROVEMENT_TRANSITION_POLICY,
} = require('../services/business/organizational-performance-transaction.service');

const context = (policy, input, idempotencyKey = 'performance-test-key') => ({ policy, input, idempotencyKey });

describe('organizational performance transaction policies', () => {
  test('refuse un objectif sans gouvernance complète', async () => {
    const result = await evaluatePolicy(context(OBJECTIVE_CREATE_POLICY, { objectiveNumber: 'OBJ-1', title: 'Croissance', description: 'Croître' }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.objective_governance_required');
  });

  test('autorise un objectif complet', async () => {
    const result = await evaluatePolicy(context(OBJECTIVE_CREATE_POLICY, { objectiveNumber: 'OBJ-1', title: 'Croissance', description: 'Croître', ownerUserId: 2, periodStart: '2026-01-01', periodEnd: '2026-12-31', perspective: 'financial', target: 20 }));
    expect(result.allowed).toBe(true);
  });

  test('exige une approbation indépendante fondée sur le propriétaire serveur', async () => {
    const result = await evaluatePolicy(context(OBJECTIVE_APPROVE_POLICY, { objectiveId: 1, ownerUserId: 2, approvedByUserId: 2, approvalReason: 'Aligné' }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.objective_independent_approval_required');
  });

  test('refuse un indicateur sans cible mesurable', async () => {
    const result = await evaluatePolicy(context(INDICATOR_CREATE_POLICY, { objectiveId: 1, indicatorNumber: 'KPI-1', name: 'Marge', definition: 'Marge nette', formula: 'résultat/revenus', sourceSystem: 'accounting', ownerUserId: 2, direction: 'higher_is_better', frequency: 'monthly', unit: '%' }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.indicator_target_required');
  });

  test('exige une analyse pour une mesure critique', async () => {
    const result = await evaluatePolicy(context(MEASUREMENT_RECORD_POLICY, { indicatorId: 1, measuredAt: '2026-07-25', value: 4, measuredByUserId: 2, sourceReference: 'ledger:2026-07', status: 'critical' }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.measurement_variance_analysis_required');
  });

  test('exige des décisions pour une revue hors cible', async () => {
    const result = await evaluatePolicy(context(REVIEW_COMPLETE_POLICY, { objectiveId: 1, reviewNumber: 'REV-1', reviewDate: '2026-07-25', reviewerUserId: 2, overallStatus: 'off_track', analysis: 'Écart important', evidence: ['proof'], nextReviewAt: '2026-08-25' }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.review_decisions_required');
  });

  test('refuse la fermeture d’un plan sans preuve d’efficacité', async () => {
    const result = await evaluatePolicy(context(IMPROVEMENT_TRANSITION_POLICY, { planId: 1, action: 'closed', implementationResult: 'Déployé', implementationEvidence: ['proof'] }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.improvement_effectiveness_proof_required');
  });
});
