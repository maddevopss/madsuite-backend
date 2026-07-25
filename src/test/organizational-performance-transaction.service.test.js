const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/organizational-performance-transaction.service');

const key = 'performance-test-key';

describe('organizational performance transaction policies', () => {
  test('refuse un objectif sans gouvernance complète', async () => {
    const result = await evaluatePolicy('performance.objective.create@1', { input: { objectiveNumber: 'OBJ-1', title: 'Croissance', description: 'Croître' }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.objective_governance_required');
  });

  test('autorise un objectif complet', async () => {
    const result = await evaluatePolicy('performance.objective.create@1', { input: { objectiveNumber: 'OBJ-1', title: 'Croissance', description: 'Croître', ownerUserId: 2, periodStart: '2026-01-01', periodEnd: '2026-12-31', perspective: 'financial', target: 20 }, idempotencyKey: key });
    expect(result.allowed).toBe(true);
  });

  test('exige une approbation indépendante', async () => {
    const result = await evaluatePolicy('performance.objective.approve@1', { input: { objectiveId: 1, approvedByUserId: 2, approvalReason: 'Aligné', approverIsOwner: true }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.objective_independent_approval_required');
  });

  test('refuse un indicateur sans cible mesurable', async () => {
    const result = await evaluatePolicy('performance.indicator.create@1', { input: { objectiveId: 1, indicatorNumber: 'KPI-1', name: 'Marge', definition: 'Marge nette', formula: 'résultat/revenus', sourceSystem: 'accounting', ownerUserId: 2, direction: 'higher_is_better', frequency: 'monthly', unit: '%' }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.indicator_target_required');
  });

  test('exige une analyse pour une mesure critique', async () => {
    const result = await evaluatePolicy('performance.measurement.record@1', { input: { indicatorId: 1, measuredAt: '2026-07-25', value: 4, measuredByUserId: 2, sourceReference: 'ledger:2026-07', status: 'critical' }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.measurement_variance_analysis_required');
  });

  test('exige décisions et preuves pour une revue hors cible', async () => {
    const result = await evaluatePolicy('performance.review.complete@1', { input: { objectiveId: 1, reviewNumber: 'REV-1', reviewDate: '2026-07-25', reviewerUserId: 2, overallStatus: 'off_track', analysis: 'Écart important', evidence: ['proof'], nextReviewAt: '2026-08-25' }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.review_decisions_required');
  });

  test('refuse la fermeture d’un plan sans preuve d’efficacité', async () => {
    const result = await evaluatePolicy('performance.improvement.transition@1', { input: { planId: 1, action: 'closed', implementationResult: 'Déployé', implementationEvidence: ['proof'] }, idempotencyKey: key });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('performance.improvement_effectiveness_proof_required');
  });
});
