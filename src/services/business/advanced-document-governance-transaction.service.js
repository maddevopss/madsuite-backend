const { registerPolicy } = require('./transaction-engine.service');

const CLASSIFICATION_CREATE_POLICY = 'documents.classification.create@1';
const VERSION_APPROVE_POLICY = 'documents.version.approve@1';
const DOCUMENT_PUBLISH_POLICY = 'documents.document.publish@1';
const RETENTION_EXECUTE_POLICY = 'documents.retention.execute@1';
const ACCESS_REVIEW_COMPLETE_POLICY = 'documents.access_review.complete@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const requireKey = (value) => hasText(value) && value.trim().length >= 8
  ? null
  : { allowed: false, statusCode: 400, code: 'documents.idempotency_required' };

registerPolicy('documents.classification.create', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.classificationCode) || !hasText(input?.name) || !input?.ownerUserId) return { allowed: false, statusCode: 400, code: 'documents.classification_fields_required' };
  if (input?.retentionYears !== undefined && Number(input.retentionYears) < 0) return { allowed: false, statusCode: 409, code: 'documents.retention_invalid' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'documents.classification_evidence_required' };
  return { allowed: true, code: 'documents.classification_create_allowed' };
});

registerPolicy('documents.version.approve', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.documentId || !input?.versionNumber || !hasText(input?.contentHash) || !hasText(input?.storageRef) || !input?.preparedByUserId || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'documents.version_fields_required' };
  if (input.preparedByUserId === input.approvedByUserId) return { allowed: false, statusCode: 409, code: 'documents.version_independent_approval_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'documents.version_evidence_required' };
  return { allowed: true, code: 'documents.version_approve_allowed' };
});

registerPolicy('documents.document.publish', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.documentId || !input?.approvedVersionId || !input?.publishedByUserId || !input?.effectiveAt) return { allowed: false, statusCode: 400, code: 'documents.publish_fields_required' };
  if (new Date(input.effectiveAt).getTime() > Date.now() && input?.allowFutureEffective !== true) return { allowed: false, statusCode: 409, code: 'documents.future_effective_date_not_authorized' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'documents.publish_evidence_required' };
  return { allowed: true, code: 'documents.document_publish_allowed' };
});

registerPolicy('documents.retention.execute', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.documentId || !hasText(input?.actionType) || !hasText(input?.reason) || !input?.requestedByUserId || !input?.approvedByUserId || !input?.executedByUserId) return { allowed: false, statusCode: 400, code: 'documents.retention_fields_required' };
  if (String(input.requestedByUserId) === String(input.approvedByUserId) || String(input.approvedByUserId) === String(input.executedByUserId)) return { allowed: false, statusCode: 409, code: 'documents.retention_separation_of_duties_required' };
  if (input?.legalHold === true && input.actionType === 'destroy') return { allowed: false, statusCode: 409, code: 'documents.legal_hold_blocks_destruction' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'documents.retention_evidence_required' };
  return { allowed: true, code: 'documents.retention_execute_allowed' };
});

registerPolicy('documents.access_review.complete', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.documentId || !input?.reviewedByUserId || !input?.reviewedAt || !hasItems(input?.authorizedRoles)) return { allowed: false, statusCode: 400, code: 'documents.access_review_fields_required' };
  if (new Date(input.reviewedAt).getTime() > Date.now()) return { allowed: false, statusCode: 409, code: 'documents.access_review_future_date' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'documents.access_review_evidence_required' };
  return { allowed: true, code: 'documents.access_review_complete_allowed' };
});

module.exports = { CLASSIFICATION_CREATE_POLICY, VERSION_APPROVE_POLICY, DOCUMENT_PUBLISH_POLICY, RETENTION_EXECUTE_POLICY, ACCESS_REVIEW_COMPLETE_POLICY };
