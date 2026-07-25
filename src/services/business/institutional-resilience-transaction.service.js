const { registerPolicy, evaluatePolicy } = require('./transaction-engine.service');

const requireIdempotency = (context) => Boolean(context?.idempotencyKey);
const notFuture = (value) => !value || new Date(value).getTime() <= Date.now();

registerPolicy('resilience.event.open', '1', (context) => {
  const event = context?.event || context?.input?.event || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!event.ownerUserId || !event.justification || !event.proofReference) return { allowed: false, code: 'EVENT_EVIDENCE_REQUIRED' };
  if (!notFuture(event.openedAt)) return { allowed: false, code: 'EVENT_DATE_IN_FUTURE' };
  return { allowed: true };
});

registerPolicy('resilience.crisis.activate', '1', (context) => {
  const cell = context?.crisisCell || context?.input?.crisisCell || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!cell.eventId || !cell.leadUserId || !cell.mandate || !cell.proofReference) return { allowed: false, code: 'CRISIS_CELL_INCOMPLETE' };
  return { allowed: true };
});

registerPolicy('resilience.decision.record', '1', (context) => {
  const decision = context?.decision || context?.input?.decision || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!decision.authorUserId || !decision.justification || !decision.proofReference) return { allowed: false, code: 'DECISION_EVIDENCE_REQUIRED' };
  if (!notFuture(decision.decidedAt)) return { allowed: false, code: 'DECISION_DATE_IN_FUTURE' };
  return { allowed: true };
});

registerPolicy('resilience.communication.publish', '1', (context) => {
  const communication = context?.communication || context?.input?.communication || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!communication.authorUserId || !communication.approverUserId || !communication.channel || !communication.proofReference) return { allowed: false, code: 'COMMUNICATION_INCOMPLETE' };
  if (communication.authorUserId === communication.approverUserId) return { allowed: false, code: 'INDEPENDENT_APPROVAL_REQUIRED' };
  return { allowed: true };
});

registerPolicy('resilience.exercise.complete', '1', (context) => {
  const exercise = context?.exercise || context?.input?.exercise || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!exercise.reportReference) return { allowed: false, code: 'EXERCISE_REPORT_REQUIRED' };
  if (!notFuture(exercise.performedAt)) return { allowed: false, code: 'EXERCISE_DATE_IN_FUTURE' };
  return { allowed: true };
});

registerPolicy('resilience.lesson.record', '1', (context) => {
  const lesson = context?.lesson || context?.input?.lesson || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!lesson.sourceType || !lesson.sourceId || !lesson.lesson || !lesson.ownerUserId || !lesson.proofReference) return { allowed: false, code: 'LESSON_INCOMPLETE' };
  return { allowed: true };
});

registerPolicy('resilience.improvement.close', '1', (context) => {
  const improvement = context?.improvement || context?.input?.improvement || {};
  if (!requireIdempotency(context)) return { allowed: false, code: 'IDEMPOTENCY_REQUIRED' };
  if (!improvement.closureProofReference) return { allowed: false, code: 'CLOSURE_PROOF_REQUIRED' };
  return { allowed: true };
});

module.exports = {
  evaluateInstitutionalResiliencePolicy(policyName, context = {}) {
    return evaluatePolicy({ policy: `${policyName}@1`, ...context });
  },
};
