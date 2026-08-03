const { registerPolicy } = require('./transaction-engine.service');

const UNIT_CREATE_POLICY = 'governance.unit.create@1';
const DELEGATION_CREATE_POLICY = 'governance.delegation.create@1';
const MEETING_COMPLETE_POLICY = 'governance.committee.meeting.complete@1';
const DECISION_CREATE_POLICY = 'governance.decision.create@1';
const DECISION_APPROVE_POLICY = 'governance.decision.approve@1';
const POLICY_PUBLISH_POLICY = 'governance.policy.publish@1';
const CONFLICT_DECLARE_POLICY = 'governance.conflict.declare@1';
const AUTHORITY_VALIDATE_POLICY = 'governance.authority.validate@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;
const requireKey = (idempotencyKey) => validIdempotency(idempotencyKey)
  ? null
  : { allowed: false, statusCode: 400, code: 'governance.idempotency_required' };

registerPolicy('governance.unit.create', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.unitCode) || !hasText(input?.name) || !hasText(input?.unitType) || !hasText(input?.mandate)) return { allowed: false, statusCode: 400, code: 'governance.unit_fields_required' };
  if (!input?.leaderUserId || !input?.effectiveFrom) return { allowed: false, statusCode: 400, code: 'governance.unit_accountability_required' };
  return { allowed: true, code: 'governance.unit_create_allowed' };
});

registerPolicy('governance.delegation.create', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.delegatorUserId || !input?.delegateUserId || input.delegatorUserId === input.delegateUserId) return { allowed: false, statusCode: 400, code: 'governance.delegation_parties_invalid' };
  if (!hasText(input?.authorityType) || !hasText(input?.reason) || !input?.startsAt || !input?.endsAt) return { allowed: false, statusCode: 400, code: 'governance.delegation_scope_required' };
  if (new Date(input.endsAt) <= new Date(input.startsAt)) return { allowed: false, statusCode: 409, code: 'governance.delegation_period_invalid' };
  if (!hasItems(input?.scope) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'governance.delegation_proof_required' };
  return { allowed: true, code: 'governance.delegation_create_allowed' };
});

registerPolicy('governance.committee.meeting.complete', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.meetingId || !input?.quorumMet) return { allowed: false, statusCode: 409, code: 'governance.meeting_quorum_required' };
  if (!hasText(input?.minutes) || !hasItems(input?.attendees) || !hasItems(input?.agenda) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'governance.meeting_record_required' };
  return { allowed: true, code: 'governance.meeting_complete_allowed' };
});

registerPolicy('governance.decision.create', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.decisionNumber) || !hasText(input?.title) || !hasText(input?.context) || !hasText(input?.analysis) || !hasText(input?.decisionText) || !hasText(input?.justification)) return { allowed: false, statusCode: 400, code: 'governance.decision_fields_required' };
  if (!input?.authorUserId || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'governance.decision_accountability_required' };
  return { allowed: true, code: 'governance.decision_create_allowed' };
});

registerPolicy('governance.decision.approve', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.decisionId || !input?.approverUserId || !hasText(input?.approvalReason)) return { allowed: false, statusCode: 400, code: 'governance.decision_approval_required' };
  if (String(input.authorUserId) === String(input.approverUserId)) return { allowed: false, statusCode: 409, code: 'governance.decision_independent_approval_required' };
  if (input?.activeConflict) return { allowed: false, statusCode: 409, code: 'governance.decision_conflict_blocked' };
  if (!input?.authorityValid) return { allowed: false, statusCode: 403, code: 'governance.authority_insufficient' };
  return { allowed: true, code: 'governance.decision_approve_allowed' };
});

registerPolicy('governance.policy.publish', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.policyId || !input?.approvedByUserId || !input?.effectiveFrom || !input?.reviewDueAt) return { allowed: false, statusCode: 400, code: 'governance.policy_governance_required' };
  if (String(input.ownerUserId) === String(input.approvedByUserId)) return { allowed: false, statusCode: 409, code: 'governance.policy_independent_approval_required' };
  if (!hasItems(input?.approvalEvidence)) return { allowed: false, statusCode: 409, code: 'governance.policy_approval_evidence_required' };
  return { allowed: true, code: 'governance.policy_publish_allowed' };
});

registerPolicy('governance.conflict.declare', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.declarantUserId || !hasText(input?.conflictNumber) || !hasText(input?.subjectType) || !hasText(input?.description) || !hasText(input?.mitigation)) return { allowed: false, statusCode: 400, code: 'governance.conflict_fields_required' };
  return { allowed: true, code: 'governance.conflict_declare_allowed' };
});

registerPolicy('governance.authority.validate', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.actorUserId || !hasText(input?.authorityType)) return { allowed: false, statusCode: 400, code: 'governance.authority_request_invalid' };
  if (input?.activeConflict) return { allowed: false, statusCode: 409, code: 'governance.authority_conflict_blocked' };
  if (input?.requestedAmount != null && input?.financialLimit != null && Number(input.requestedAmount) > Number(input.financialLimit)) return { allowed: false, statusCode: 403, code: 'governance.authority_limit_exceeded' };
  if (!input?.withinScope || !input?.withinPeriod) return { allowed: false, statusCode: 403, code: 'governance.authority_out_of_scope' };
  return { allowed: true, code: 'governance.authority_valid' };
});

module.exports = { UNIT_CREATE_POLICY, DELEGATION_CREATE_POLICY, MEETING_COMPLETE_POLICY, DECISION_CREATE_POLICY, DECISION_APPROVE_POLICY, POLICY_PUBLISH_POLICY, CONFLICT_DECLARE_POLICY, AUTHORITY_VALIDATE_POLICY };