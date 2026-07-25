const { evaluateInstitutionalResiliencePolicy } = require('../services/business/institutional-resilience-transaction.service');

describe('institutional resilience transaction policies', () => {
  test('accepts a complete event', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.event.open', {
      idempotencyKey: 'evt-1',
      event: { ownerUserId: 1, justification: 'Incident majeur', proofReference: 'proof://event/1' },
    });
    expect(result.allowed).toBe(true);
  });

  test('rejects an event without evidence', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.event.open', {
      idempotencyKey: 'evt-2', event: { ownerUserId: 1, justification: 'Incident' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'EVENT_EVIDENCE_REQUIRED' });
  });

  test('requires a complete crisis cell', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.crisis.activate', {
      idempotencyKey: 'cell-1', crisisCell: { eventId: 3, leadUserId: 2, mandate: 'Coordonner', proofReference: 'proof://cell/1' },
    });
    expect(result.allowed).toBe(true);
  });

  test('rejects a future decision', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.decision.record', {
      idempotencyKey: 'decision-1',
      decision: { authorUserId: 2, justification: 'Protection', proofReference: 'proof://decision/1', decidedAt: '2999-01-01' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'DECISION_DATE_IN_FUTURE' });
  });

  test('requires independent communication approval', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.communication.publish', {
      idempotencyKey: 'com-1',
      communication: { authorUserId: 4, approverUserId: 4, channel: 'email', proofReference: 'proof://com/1' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'INDEPENDENT_APPROVAL_REQUIRED' });
  });

  test('requires an exercise report', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.exercise.complete', {
      idempotencyKey: 'exercise-1', exercise: { performedAt: '2026-01-01' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'EXERCISE_REPORT_REQUIRED' });
  });

  test('requires lesson traceability', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.lesson.record', {
      idempotencyKey: 'lesson-1',
      lesson: { sourceType: 'event', sourceId: 1, lesson: 'Clarifier les rôles', ownerUserId: 2, proofReference: 'proof://lesson/1' },
    });
    expect(result.allowed).toBe(true);
  });

  test('requires closure proof', () => {
    const result = evaluateInstitutionalResiliencePolicy('resilience.improvement.close', {
      idempotencyKey: 'improvement-1', improvement: {},
    });
    expect(result).toMatchObject({ allowed: false, code: 'CLOSURE_PROOF_REQUIRED' });
  });
});