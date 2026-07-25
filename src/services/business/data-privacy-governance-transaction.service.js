const { registerPolicy } = require('./transaction-engine.service');

const PROCESSING_CREATE_POLICY = 'privacy.processing.create@1';
const CONSENT_RECORD_POLICY = 'privacy.consent.record@1';
const SUBJECT_REQUEST_TRANSITION_POLICY = 'privacy.subject_request.transition@1';
const INCIDENT_RECORD_POLICY = 'privacy.incident.record@1';
const INCIDENT_CLOSE_POLICY = 'privacy.incident.close@1';
const RETENTION_COMPLETE_POLICY = 'privacy.retention.complete@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;

registerPolicy('privacy.processing.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'privacy.idempotency_required' };
  if (!hasText(input?.activityNumber) || !hasText(input?.name) || !hasText(input?.purpose) || !hasText(input?.legalBasis)) return { allowed: false, statusCode: 400, code: 'privacy.processing_fields_required' };
  if (!input?.ownerUserId || !input?.nextReviewAt || !Number.isInteger(Number(input?.retentionPeriodDays)) || Number(input.retentionPeriodDays) <= 0) return { allowed: false, statusCode: 400, code: 'privacy.processing_governance_required' };
  if (!hasItems(input?.dataCategories) || !hasItems(input?.subjectCategories)) return { allowed: false, statusCode: 409, code: 'privacy.processing_scope_required' };
  return { allowed: true, code: 'privacy.processing_create_allowed' };
});

registerPolicy('privacy.consent.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'privacy.idempotency_required' };
  if (!hasText(input?.subjectReference) || !hasText(input?.purpose) || !hasText(input?.source)) return { allowed: false, statusCode: 400, code: 'privacy.consent_fields_required' };
  if (input?.status === 'granted' && !hasItems(input?.proof)) return { allowed: false, statusCode: 409, code: 'privacy.consent_proof_required' };
  if (input?.status === 'withdrawn' && !input?.withdrawnAt) return { allowed: false, statusCode: 400, code: 'privacy.withdrawal_timestamp_required' };
  return { allowed: true, code: 'privacy.consent_record_allowed' };
});

registerPolicy('privacy.subject_request.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'privacy.idempotency_required' };
  if (!hasText(input?.requestNumber) || !hasText(input?.requestType) || !hasText(input?.subjectReference) || !input?.ownerUserId || !input?.dueAt) return { allowed: false, statusCode: 400, code: 'privacy.request_fields_required' };
  if (['verified','in_progress','completed','refused'].includes(input?.status) && !hasItems(input?.identityVerification)) return { allowed: false, statusCode: 409, code: 'privacy.identity_verification_required' };
  if (input?.status === 'completed' && (!hasText(input?.responseSummary) || !hasItems(input?.evidence))) return { allowed: false, statusCode: 409, code: 'privacy.request_completion_proof_required' };
  if (input?.status === 'refused' && !hasText(input?.refusalReason)) return { allowed: false, statusCode: 409, code: 'privacy.refusal_reason_required' };
  return { allowed: true, code: 'privacy.subject_request_transition_allowed' };
});

registerPolicy('privacy.incident.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'privacy.idempotency_required' };
  if (!hasText(input?.incidentNumber) || !hasText(input?.title) || !hasText(input?.description) || !input?.ownerUserId) return { allowed: false, statusCode: 400, code: 'privacy.incident_fields_required' };
  if (['high','critical'].includes(input?.severity) && (!hasItems(input?.affectedData) || !hasItems(input?.decisionLog))) return { allowed: false, statusCode: 409, code: 'privacy.major_incident_proof_required' };
  if (input?.notificationRequired !== null && input?.notificationRequired !== undefined && !hasText(input?.notificationDecisionReason)) return { allowed: false, statusCode: 409, code: 'privacy.notification_reason_required' };
  return { allowed: true, code: 'privacy.incident_record_allowed' };
});

registerPolicy('privacy.incident.close', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'privacy.idempotency_required' };
  if (!input?.incidentId || !hasText(input?.rootCause) || !hasText(input?.lessonsLearned) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'privacy.incident_closure_proof_required' };
  return { allowed: true, code: 'privacy.incident_close_allowed' };
});

registerPolicy('privacy.retention.complete', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'privacy.idempotency_required' };
  if (!input?.processingActivityId || !hasText(input?.actionNumber) || !hasText(input?.actionType)) return { allowed: false, statusCode: 400, code: 'privacy.retention_fields_required' };
  if (input?.status === 'completed' && (!hasText(input?.result) || !hasItems(input?.evidence))) return { allowed: false, statusCode: 409, code: 'privacy.retention_completion_proof_required' };
  return { allowed: true, code: 'privacy.retention_complete_allowed' };
});

module.exports = {
  PROCESSING_CREATE_POLICY,
  CONSENT_RECORD_POLICY,
  SUBJECT_REQUEST_TRANSITION_POLICY,
  INCIDENT_RECORD_POLICY,
  INCIDENT_CLOSE_POLICY,
  RETENTION_COMPLETE_POLICY,
};
