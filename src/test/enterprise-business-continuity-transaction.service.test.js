const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/enterprise-business-continuity-transaction.service');

const context = (input, idempotencyKey = 'continuity-test-001') => ({ input, idempotencyKey });

describe('enterprise business continuity transaction policies', () => {
  test('refuse un processus lorsque le RTO dépasse la durée maximale tolérable', () => {
    const result = evaluatePolicy('continuity.process.create@1', context({
      processNumber: 'PROC-001',
      name: 'Facturation',
      description: 'Facturer les clients',
      ownerUserId: 42,
      maximumTolerableDowntimeMinutes: 60,
      recoveryTimeObjectiveMinutes: 120,
      nextReviewAt: '2027-01-01T00:00:00Z',
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.rto_exceeds_mtd');
  });

  test('autorise un processus gouverné avec des objectifs cohérents', () => {
    const result = evaluatePolicy('continuity.process.create@1', context({
      processNumber: 'PROC-001',
      name: 'Facturation',
      description: 'Facturer les clients',
      ownerUserId: 42,
      maximumTolerableDowntimeMinutes: 240,
      recoveryTimeObjectiveMinutes: 60,
      nextReviewAt: '2027-01-01T00:00:00Z',
    }));
    expect(result.allowed).toBe(true);
  });

  test('refuse un plan sans procédures ni ressources', () => {
    const result = evaluatePolicy('continuity.plan.create@1', context({
      processId: 1,
      planNumber: 'PCA-001',
      title: 'Panne réseau',
      scenario: 'Perte du lien principal',
      activationConditions: 'Indisponibilité supérieure à 15 minutes',
      ownerUserId: 42,
      nextReviewAt: '2027-01-01T00:00:00Z',
      procedures: [],
      resources: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.plan_content_required');
  });

  test('refuse un exercice sans conclusion ni preuve', () => {
    const result = evaluatePolicy('continuity.exercise.record@1', context({
      planId: 1,
      exerciseNumber: 'EX-001',
      scenario: 'Panne réseau',
      result: 'partial',
      conclusion: '',
      evidence: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.exercise_proof_required');
  });

  test('refuse un événement majeur sans journal de décisions', () => {
    const result = evaluatePolicy('continuity.event.record@1', context({
      eventNumber: 'EVT-001',
      title: 'Interruption majeure',
      description: 'Perte simultanée de deux services',
      ownerUserId: 42,
      decisionLog: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.decision_log_required');
  });

  test('refuse la fermeture sans retour d’expérience et preuve', () => {
    const result = evaluatePolicy('continuity.event.close@1', context({
      eventId: 1,
      lessonsLearned: '',
      evidence: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.event_closure_proof_required');
  });
});
