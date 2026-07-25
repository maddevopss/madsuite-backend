const { registerPolicy } = require('./transaction-engine.service');

const PROCESS_CREATE_POLICY = 'continuity.process.create@1';
const PLAN_CREATE_POLICY = 'continuity.plan.create@1';
const PLAN_ACTIVATE_POLICY = 'continuity.plan.activate@1';
const EXERCISE_RECORD_POLICY = 'continuity.exercise.record@1';
const EVENT_RECORD_POLICY = 'continuity.event.record@1';
const EVENT_CLOSE_POLICY = 'continuity.event.close@1';
const REVIEW_COMPLETE_POLICY = 'continuity.review.complete@1';

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function validIdempotency(value) {
  return hasText(value) && value.trim().length >= 8;
}

function validPositiveMinutes(value, allowZero = false) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && (allowZero ? minutes >= 0 : minutes > 0);
}

registerPolicy('continuity.process.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!hasText(input?.processNumber) || !hasText(input?.name) || !hasText(input?.description)) return { allowed: false, statusCode: 400, code: 'continuity.process_fields_required' };
  if (!input?.ownerUserId) return { allowed: false, statusCode: 400, code: 'continuity.owner_required' };
  if (!validPositiveMinutes(input?.maximumTolerableDowntimeMinutes) || !validPositiveMinutes(input?.recoveryTimeObjectiveMinutes)) return { allowed: false, statusCode: 400, code: 'continuity.recovery_objectives_invalid' };
  if (Number(input.recoveryTimeObjectiveMinutes) > Number(input.maximumTolerableDowntimeMinutes)) return { allowed: false, statusCode: 409, code: 'continuity.rto_exceeds_mtd' };
  if (!input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'continuity.next_review_required' };
  return { allowed: true, code: 'continuity.process_create_allowed' };
});

registerPolicy('continuity.plan.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!input?.processId || !hasText(input?.planNumber) || !hasText(input?.title) || !hasText(input?.scenario) || !hasText(input?.activationConditions)) return { allowed: false, statusCode: 400, code: 'continuity.plan_fields_required' };
  if (!input?.ownerUserId || !input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'continuity.plan_governance_required' };
  if (!hasItems(input?.procedures) || !hasItems(input?.resources)) return { allowed: false, statusCode: 409, code: 'continuity.plan_content_required' };
  return { allowed: true, code: 'continuity.plan_create_allowed' };
});

registerPolicy('continuity.plan.activate', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!input?.planId || !hasItems(input?.evidence) || !hasText(input?.activationReason)) return { allowed: false, statusCode: 409, code: 'continuity.activation_proof_required' };
  return { allowed: true, code: 'continuity.plan_activate_allowed' };
});

registerPolicy('continuity.exercise.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!input?.planId || !hasText(input?.exerciseNumber) || !hasText(input?.scenario) || !hasText(input?.result)) return { allowed: false, statusCode: 400, code: 'continuity.exercise_fields_required' };
  if (!hasText(input?.conclusion) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'continuity.exercise_proof_required' };
  return { allowed: true, code: 'continuity.exercise_record_allowed' };
});

registerPolicy('continuity.event.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!hasText(input?.eventNumber) || !hasText(input?.title) || !hasText(input?.description) || !input?.ownerUserId) return { allowed: false, statusCode: 400, code: 'continuity.event_fields_required' };
  if (!hasItems(input?.decisionLog)) return { allowed: false, statusCode: 409, code: 'continuity.decision_log_required' };
  return { allowed: true, code: 'continuity.event_record_allowed' };
});

registerPolicy('continuity.event.close', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!input?.eventId || !hasText(input?.lessonsLearned) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'continuity.event_closure_proof_required' };
  return { allowed: true, code: 'continuity.event_close_allowed' };
});

registerPolicy('continuity.review.complete', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'continuity.idempotency_required' };
  if (!input?.planId || !hasText(input?.reviewNumber) || !hasText(input?.conclusion) || !input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'continuity.review_fields_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'continuity.review_evidence_required' };
  return { allowed: true, code: 'continuity.review_complete_allowed' };
});

module.exports = {
  PROCESS_CREATE_POLICY,
  PLAN_CREATE_POLICY,
  PLAN_ACTIVATE_POLICY,
  EXERCISE_RECORD_POLICY,
  EVENT_RECORD_POLICY,
  EVENT_CLOSE_POLICY,
  REVIEW_COMPLETE_POLICY,
  validPositiveMinutes,
};
