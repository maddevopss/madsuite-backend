const { registerPolicy } = require('./transaction-engine.service');

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const requireKey = (value) => hasText(value) && value.trim().length >= 8
  ? null
  : { allowed: false, statusCode: 400, code: 'partners.idempotency_required' };

registerPolicy('partners.partner.register', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.partnerCode) || !hasText(input?.legalName) || !hasText(input?.partnerType)) return { allowed: false, statusCode: 400, code: 'partners.partner_fields_required' };
  if (!input?.relationshipOwnerUserId || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'partners.partner_accountability_required' };
  return { allowed: true, code: 'partners.partner_register_allowed' };
});

registerPolicy('partners.agreement.approve', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.partnerId || !hasText(input?.agreementNumber) || !hasText(input?.agreementType) || !hasText(input?.title) || !input?.effectiveFrom) return { allowed: false, statusCode: 400, code: 'partners.agreement_fields_required' };
  if (input.effectiveTo && new Date(input.effectiveTo) < new Date(input.effectiveFrom)) return { allowed: false, statusCode: 409, code: 'partners.agreement_period_invalid' };
  if (!input?.ownerUserId || !input?.approvedByUserId || input.ownerUserId === input.approvedByUserId) return { allowed: false, statusCode: 409, code: 'partners.agreement_independent_approval_required' };
  if (!hasItems(input?.responsibilities) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'partners.agreement_scope_proof_required' };
  return { allowed: true, code: 'partners.agreement_approve_allowed' };
});

registerPolicy('partners.certification.verify', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.partnerId || !hasText(input?.certificationType) || !hasText(input?.issuedBy) || !input?.verifiedByUserId) return { allowed: false, statusCode: 400, code: 'partners.certification_fields_required' };
  if (input.expiresAt && input.issuedAt && new Date(input.expiresAt) < new Date(input.issuedAt)) return { allowed: false, statusCode: 409, code: 'partners.certification_period_invalid' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'partners.certification_evidence_required' };
  return { allowed: true, code: 'partners.certification_verify_allowed' };
});

registerPolicy('partners.assessment.complete', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.partnerId || !hasText(input?.assessmentType) || !input?.assessedAt || !input?.assessedByUserId || !hasText(input?.riskLevel)) return { allowed: false, statusCode: 400, code: 'partners.assessment_fields_required' };
  if (new Date(input.assessedAt) > new Date()) return { allowed: false, statusCode: 409, code: 'partners.assessment_future_date' };
  if (!hasItems(input?.criteria) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'partners.assessment_record_required' };
  return { allowed: true, code: 'partners.assessment_complete_allowed' };
});

registerPolicy('partners.incident.report', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.partnerId || !input?.occurredAt || !hasText(input?.incidentType) || !hasText(input?.severity) || !hasText(input?.description) || !input?.responsibleUserId) return { allowed: false, statusCode: 400, code: 'partners.incident_fields_required' };
  if (new Date(input.occurredAt) > new Date()) return { allowed: false, statusCode: 409, code: 'partners.incident_future_date' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'partners.incident_evidence_required' };
  return { allowed: true, code: 'partners.incident_report_allowed' };
});

module.exports = {};