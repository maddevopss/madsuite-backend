const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  PROCESS_CREATE_POLICY,
  PLAN_CREATE_POLICY,
  EXERCISE_RECORD_POLICY,
  EVENT_RECORD_POLICY,
  EVENT_CLOSE_POLICY,
} = require('../services/business/enterprise-business-continuity-transaction.service');

const context = (input, idempotencyKey = 'continuity-test-001') => ({ input, idempotencyKey });
const evaluate = (policy, input, idempotencyKey) => evaluatePolicy({
  policy,
  ...context(input, idempotencyKey),
});

describe('enterprise business continuity transaction policies', () => {
  test('refuse un processus lorsque le RTO dépasse la durée maximale tolérable', async () => {
    const result = await evaluate(PROCESS_CREATE_POLICY, {
      processNumber: 'PROC-001',
      name: 'Facturation',
      description: 'Facturer les clients',
      ownerUserId: 42,
      maximumTolerableDowntimeMinutes: 60,
      recoveryTimeObjectiveMinutes: 120,
      nextReviewAt: '2027-01-01T00:00:00Z',
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.rto_exceeds_mtd');
  });

  test('autorise un processus gouverné avec des objectifs cohérents', async () => {
    const result = await evaluate(PROCESS_CREATE_POLICY, {
      processNumber: 'PROC-001',
      name: 'Facturation',
      description: 'Facturer les clients',
      ownerUserId: 42,
      maximumTolerableDowntimeMinutes: 240,
      recoveryTimeObjectiveMinutes: 60,
      nextReviewAt: '2027-01-01T00:00:00Z',
    });
    expect(result.allowed).toBe(true);
  });

  test('refuse un plan sans procédures ni ressources', async () => {
    const result = await evaluate(PLAN_CREATE_POLICY, {
      processId: 1,
      planNumber: 'PCA-001',
      title: 'Panne réseau',
      scenario: 'Perte du lien principal',
      activationConditions: 'Indisponibilité supérieure à 15 minutes',
      ownerUserId: 42,
      nextReviewAt: '2027-01-01T00:00:00Z',
      procedures: [],
      resources: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.plan_content_required');
  });

  test('refuse un exercice sans conclusion ni preuve', async () => {
    const result = await evaluate(EXERCISE_RECORD_POLICY, {
      planId: 1,
      exerciseNumber: 'EX-001',
      scenario: 'Panne réseau',
      result: 'partial',
      conclusion: '',
      evidence: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.exercise_proof_required');
  });

  test('refuse un événement majeur sans journal de décisions', async () => {
    const result = await evaluate(EVENT_RECORD_POLICY, {
      eventNumber: 'EVT-001',
      title: 'Interruption majeure',
      description: 'Perte simultanée de deux services',
      ownerUserId: 42,
      decisionLog: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.decision_log_required');
  });

  test('refuse la fermeture sans retour d’expérience et preuve', async () => {
    const result = await evaluate(EVENT_CLOSE_POLICY, {
      eventId: 1,
      lessonsLearned: '',
      evidence: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('continuity.event_closure_proof_required');
  });
});
