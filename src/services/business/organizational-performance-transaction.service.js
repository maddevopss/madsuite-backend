const { registerPolicy } = require('./transaction-engine.service');

const OBJECTIVE_CREATE_POLICY = 'performance.objective.create@1';
const OBJECTIVE_APPROVE_POLICY = 'performance.objective.approve@1';
const INDICATOR_CREATE_POLICY = 'performance.indicator.create@1';
const MEASUREMENT_RECORD_POLICY = 'performance.measurement.record@1';
const REVIEW_COMPLETE_POLICY = 'performance.review.complete@1';
const IMPROVEMENT_TRANSITION_POLICY = 'performance.improvement.transition@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;
const isFiniteNumber = (value) => Number.isFinite(Number(value));

registerPolicy('performance.objective.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'performance.idempotency_required' };
  if (!hasText(input?.objectiveNumber) || !hasText(input?.title) || !hasText(input?.description)) return { allowed: false, statusCode: 400, code: 'performance.objective_fields_required' };
  if (!input?.ownerUserId || !input?.periodStart || !input?.periodEnd || !hasText(input?.perspective)) return { allowed: false, statusCode: 400, code: 'performance.objective_governance_required' };
  if (new Date(input.periodEnd) < new Date(input.periodStart)) return { allowed: false, statusCode: 409, code: 'performance.objective_period_invalid' };
  if (input?.target !== undefined && !isFiniteNumber(input.target)) return { allowed: false, statusCode: 400, code: 'performance.objective_target_invalid' };
  return { allowed: true, code: 'performance.objective_create_allowed' };
});

registerPolicy('performance.objective.approve', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'performance.idempotency_required' };
  if (!input?.objectiveId || !input?.approvedByUserId || !hasText(input?.approvalReason)) return { allowed: false, statusCode: 400, code: 'performance.objective_approval_required' };
  if (input?.approverIsOwner === true) return { allowed: false, statusCode: 409, code: 'performance.objective_independent_approval_required' };
  return { allowed: true, code: 'performance.objective_approve_allowed' };
});

registerPolicy('performance.indicator.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'performance.idempotency_required' };
  if (!input?.objectiveId || !hasText(input?.indicatorNumber) || !hasText(input?.name) || !hasText(input?.definition) || !hasText(input?.formula)) return { allowed: false, statusCode: 400, code: 'performance.indicator_fields_required' };
  if (!hasText(input?.sourceSystem) || !input?.ownerUserId || !hasText(input?.direction) || !hasText(input?.frequency) || !hasText(input?.unit)) return { allowed: false, statusCode: 400, code: 'performance.indicator_governance_required' };
  if (!isFiniteNumber(input?.target)) return { allowed: false, statusCode: 400, code: 'performance.indicator_target_required' };
  return { allowed: true, code: 'performance.indicator_create_allowed' };
});

registerPolicy('performance.measurement.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'performance.idempotency_required' };
  if (!input?.indicatorId || !input?.measuredAt || !isFiniteNumber(input?.value) || !input?.measuredByUserId) return { allowed: false, statusCode: 400, code: 'performance.measurement_fields_required' };
  if (!hasText(input?.sourceReference) || !hasText(input?.status)) return { allowed: false, statusCode: 400, code: 'performance.measurement_traceability_required' };
  if (['warning','critical'].includes(input.status) && !hasText(input?.commentary)) return { allowed: false, statusCode: 409, code: 'performance.measurement_variance_analysis_required' };
  return { allowed: true, code: 'performance.measurement_record_allowed' };
});

registerPolicy('performance.review.complete', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'performance.idempotency_required' };
  if (!input?.objectiveId || !hasText(input?.reviewNumber) || !input?.reviewDate || !input?.reviewerUserId || !hasText(input?.overallStatus) || !hasText(input?.analysis)) return { allowed: false, statusCode: 400, code: 'performance.review_fields_required' };
  if (['watch','off_track'].includes(input.overallStatus) && !hasItems(input?.decisions)) return { allowed: false, statusCode: 409, code: 'performance.review_decisions_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'performance.review_evidence_required' };
  if (input.overallStatus !== 'achieved' && !input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'performance.next_review_required' };
  return { allowed: true, code: 'performance.review_complete_allowed' };
});

registerPolicy('performance.improvement.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'performance.idempotency_required' };
  if (!input?.planId || !hasText(input?.action)) return { allowed: false, statusCode: 400, code: 'performance.improvement_transition_invalid' };
  if (['implemented','verified','closed'].includes(input.action) && (!hasText(input?.implementationResult) || !hasItems(input?.implementationEvidence))) return { allowed: false, statusCode: 409, code: 'performance.improvement_implementation_proof_required' };
  if (['verified','closed'].includes(input.action) && (!hasText(input?.effectivenessResult) || !hasItems(input?.verificationEvidence) || !input?.verifiedByUserId)) return { allowed: false, statusCode: 409, code: 'performance.improvement_effectiveness_proof_required' };
  return { allowed: true, code: 'performance.improvement_transition_allowed' };
});

module.exports = { OBJECTIVE_CREATE_POLICY, OBJECTIVE_APPROVE_POLICY, INDICATOR_CREATE_POLICY, MEASUREMENT_RECORD_POLICY, REVIEW_COMPLETE_POLICY, IMPROVEMENT_TRANSITION_POLICY };
