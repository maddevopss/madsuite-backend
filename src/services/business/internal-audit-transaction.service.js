const { registerPolicy } = require('./transaction-engine.service');

const PROGRAM_CREATE_POLICY = 'audit.program.create@1';
const ENGAGEMENT_COMPLETE_POLICY = 'audit.engagement.complete@1';
const FINDING_CREATE_POLICY = 'audit.finding.create@1';
const ACTION_TRANSITION_POLICY = 'audit.action.transition@1';
const FINDING_CLOSE_POLICY = 'audit.finding.close@1';
const FOLLOWUP_COMPLETE_POLICY = 'audit.followup.complete@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;

registerPolicy('audit.program.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'audit.idempotency_required' };
  if (!hasText(input?.programNumber) || !hasText(input?.title) || !hasText(input?.objectives)) return { allowed: false, statusCode: 400, code: 'audit.program_fields_required' };
  if (!input?.ownerUserId || !input?.periodStart || !input?.periodEnd) return { allowed: false, statusCode: 400, code: 'audit.program_governance_required' };
  if (!hasItems(input?.scope) || !hasItems(input?.riskBasis)) return { allowed: false, statusCode: 409, code: 'audit.program_basis_required' };
  return { allowed: true, code: 'audit.program_create_allowed' };
});

registerPolicy('audit.engagement.complete', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'audit.idempotency_required' };
  if (!input?.engagementId || !hasText(input?.conclusion)) return { allowed: false, statusCode: 400, code: 'audit.engagement_conclusion_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'audit.engagement_evidence_required' };
  return { allowed: true, code: 'audit.engagement_complete_allowed' };
});

registerPolicy('audit.finding.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'audit.idempotency_required' };
  if (!input?.engagementId || !hasText(input?.findingNumber) || !hasText(input?.classification) || !hasText(input?.title) || !hasText(input?.description) || !hasText(input?.criterion)) return { allowed: false, statusCode: 400, code: 'audit.finding_fields_required' };
  if (!input?.ownerUserId) return { allowed: false, statusCode: 400, code: 'audit.finding_owner_required' };
  if (['major','critical'].includes(input.classification) && !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'audit.material_finding_evidence_required' };
  return { allowed: true, code: 'audit.finding_create_allowed' };
});

registerPolicy('audit.action.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'audit.idempotency_required' };
  if (!input?.actionId || !hasText(input?.action)) return { allowed: false, statusCode: 400, code: 'audit.action_transition_invalid' };
  if (['implemented','verified','closed'].includes(input.action) && (!hasText(input?.implementationResult) || !hasItems(input?.implementationEvidence))) return { allowed: false, statusCode: 409, code: 'audit.action_implementation_proof_required' };
  if (['verified','closed'].includes(input.action) && (!hasText(input?.effectivenessResult) || !hasItems(input?.verificationEvidence))) return { allowed: false, statusCode: 409, code: 'audit.action_effectiveness_proof_required' };
  return { allowed: true, code: 'audit.action_transition_allowed' };
});

registerPolicy('audit.finding.close', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'audit.idempotency_required' };
  if (!input?.findingId || !hasText(input?.closureReason) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'audit.finding_closure_proof_required' };
  if (input?.openActionsCount > 0) return { allowed: false, statusCode: 409, code: 'audit.finding_open_actions' };
  return { allowed: true, code: 'audit.finding_close_allowed' };
});

registerPolicy('audit.followup.complete', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'audit.idempotency_required' };
  if (!input?.engagementId || !hasText(input?.followupNumber) || !input?.reviewerUserId || !hasText(input?.conclusion)) return { allowed: false, statusCode: 400, code: 'audit.followup_fields_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'audit.followup_evidence_required' };
  if (input?.status === 'additional_action_required' && !input?.nextFollowupAt) return { allowed: false, statusCode: 400, code: 'audit.next_followup_required' };
  return { allowed: true, code: 'audit.followup_complete_allowed' };
});

module.exports = { PROGRAM_CREATE_POLICY, ENGAGEMENT_COMPLETE_POLICY, FINDING_CREATE_POLICY, ACTION_TRANSITION_POLICY, FINDING_CLOSE_POLICY, FOLLOWUP_COMPLETE_POLICY };
