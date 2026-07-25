const { registerPolicy } = require('./transaction-engine.service');

const ASSET_CREATE_POLICY = 'cybersecurity.asset.create@1';
const CONTROL_VERIFY_POLICY = 'cybersecurity.control.verify@1';
const VULNERABILITY_TRANSITION_POLICY = 'cybersecurity.vulnerability.transition@1';
const INCIDENT_RECORD_POLICY = 'cybersecurity.incident.record@1';
const INCIDENT_CLOSE_POLICY = 'cybersecurity.incident.close@1';
const ACCESS_REVIEW_COMPLETE_POLICY = 'cybersecurity.access_review.complete@1';
const EXERCISE_RECORD_POLICY = 'cybersecurity.exercise.record@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;

registerPolicy('cybersecurity.asset.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!hasText(input?.assetNumber) || !hasText(input?.name) || !hasText(input?.assetType)) return { allowed: false, statusCode: 400, code: 'cybersecurity.asset_fields_required' };
  if (!input?.ownerUserId || !input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'cybersecurity.asset_governance_required' };
  return { allowed: true, code: 'cybersecurity.asset_create_allowed' };
});

registerPolicy('cybersecurity.control.verify', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!input?.controlId || !hasText(input?.result) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'cybersecurity.control_verification_proof_required' };
  if (!input?.nextVerificationAt) return { allowed: false, statusCode: 400, code: 'cybersecurity.next_verification_required' };
  return { allowed: true, code: 'cybersecurity.control_verify_allowed' };
});

registerPolicy('cybersecurity.vulnerability.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!input?.vulnerabilityId || !hasText(input?.action)) return { allowed: false, statusCode: 400, code: 'cybersecurity.vulnerability_transition_invalid' };
  if (['mitigated','closed'].includes(input.action) && !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'cybersecurity.vulnerability_evidence_required' };
  if (input.action === 'accepted' && !hasText(input?.acceptanceReason)) return { allowed: false, statusCode: 409, code: 'cybersecurity.acceptance_reason_required' };
  if (['in_remediation','mitigated','closed'].includes(input.action) && !hasText(input?.remediationPlan)) return { allowed: false, statusCode: 409, code: 'cybersecurity.remediation_plan_required' };
  return { allowed: true, code: 'cybersecurity.vulnerability_transition_allowed' };
});

registerPolicy('cybersecurity.incident.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!hasText(input?.incidentNumber) || !hasText(input?.title) || !hasText(input?.description) || !input?.ownerUserId || !input?.occurredAt) return { allowed: false, statusCode: 400, code: 'cybersecurity.incident_fields_required' };
  if (['high','critical'].includes(input?.severity) && (!hasItems(input?.affectedAssets) || !hasItems(input?.decisionLog))) return { allowed: false, statusCode: 409, code: 'cybersecurity.major_incident_trace_required' };
  return { allowed: true, code: 'cybersecurity.incident_record_allowed' };
});

registerPolicy('cybersecurity.incident.close', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!input?.incidentId || !hasText(input?.rootCause) || !hasText(input?.lessonsLearned) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'cybersecurity.incident_closure_proof_required' };
  return { allowed: true, code: 'cybersecurity.incident_close_allowed' };
});

registerPolicy('cybersecurity.access_review.complete', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!hasText(input?.reviewNumber) || !hasText(input?.scope) || !input?.reviewerUserId || !hasText(input?.conclusion) || !input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'cybersecurity.access_review_fields_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'cybersecurity.access_review_evidence_required' };
  if (hasItems(input?.exceptions) && !hasItems(input?.remediationActions)) return { allowed: false, statusCode: 409, code: 'cybersecurity.access_review_remediation_required' };
  return { allowed: true, code: 'cybersecurity.access_review_complete_allowed' };
});

registerPolicy('cybersecurity.exercise.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'cybersecurity.idempotency_required' };
  if (!hasText(input?.exerciseNumber) || !hasText(input?.exerciseType) || !hasText(input?.scenario) || !input?.ownerUserId || !hasText(input?.result)) return { allowed: false, statusCode: 400, code: 'cybersecurity.exercise_fields_required' };
  if (!hasText(input?.conclusion) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'cybersecurity.exercise_proof_required' };
  return { allowed: true, code: 'cybersecurity.exercise_record_allowed' };
});

module.exports = { ASSET_CREATE_POLICY, CONTROL_VERIFY_POLICY, VULNERABILITY_TRANSITION_POLICY, INCIDENT_RECORD_POLICY, INCIDENT_CLOSE_POLICY, ACCESS_REVIEW_COMPLETE_POLICY, EXERCISE_RECORD_POLICY };
