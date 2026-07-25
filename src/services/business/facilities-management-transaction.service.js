const { registerPolicy } = require('./transaction-engine.service');

const SITE_CREATE_POLICY = 'facilities.site.create@1';
const SPACE_CREATE_POLICY = 'facilities.space.create@1';
const INSPECTION_COMPLETE_POLICY = 'facilities.inspection.complete@1';
const TRANSFER_ACCEPT_POLICY = 'facilities.transfer.accept@1';
const ASSET_DECOMMISSION_POLICY = 'facilities.asset.decommission@1';
const ASSET_DISPOSE_POLICY = 'facilities.asset.dispose@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const requireKey = (value) => hasText(value) && value.trim().length >= 8
  ? null
  : { allowed: false, statusCode: 400, code: 'facilities.idempotency_required' };

registerPolicy('facilities.site.create', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.siteCode) || !hasText(input?.name) || !hasText(input?.siteType)) return { allowed: false, statusCode: 400, code: 'facilities.site_fields_required' };
  if (!input?.responsibleUserId || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'facilities.site_accountability_required' };
  return { allowed: true, code: 'facilities.site_create_allowed' };
});

registerPolicy('facilities.space.create', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.siteId || !hasText(input?.spaceCode) || !hasText(input?.name) || !hasText(input?.spaceType)) return { allowed: false, statusCode: 400, code: 'facilities.space_fields_required' };
  if (!input?.responsibleUserId || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'facilities.space_accountability_required' };
  return { allowed: true, code: 'facilities.space_create_allowed' };
});

registerPolicy('facilities.inspection.complete', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.subjectType) || !input?.subjectId || !input?.inspectorUserId || !input?.inspectedAt) return { allowed: false, statusCode: 400, code: 'facilities.inspection_fields_required' };
  if (new Date(input.inspectedAt) > new Date()) return { allowed: false, statusCode: 409, code: 'facilities.inspection_future_date' };
  if (!hasItems(input?.findings) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'facilities.inspection_record_required' };
  return { allowed: true, code: 'facilities.inspection_complete_allowed' };
});

registerPolicy('facilities.transfer.accept', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.subjectType) || !input?.subjectId || !input?.requestedByUserId || !input?.acceptedByUserId || !hasText(input?.reason)) return { allowed: false, statusCode: 400, code: 'facilities.transfer_fields_required' };
  if (input.requestedByUserId === input.acceptedByUserId) return { allowed: false, statusCode: 409, code: 'facilities.transfer_independent_acceptance_required' };
  if ((!input?.toSiteId && !input?.toSpaceId) || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'facilities.transfer_destination_proof_required' };
  return { allowed: true, code: 'facilities.transfer_accept_allowed' };
});

registerPolicy('facilities.asset.decommission', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.assetId || !hasText(input?.reason) || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'facilities.decommission_fields_required' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'facilities.decommission_evidence_required' };
  return { allowed: true, code: 'facilities.asset_decommission_allowed' };
});

registerPolicy('facilities.asset.dispose', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.assetId || !hasText(input?.disposalMethod) || !hasText(input?.reason) || !input?.requestedByUserId || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'facilities.disposal_fields_required' };
  if (input.requestedByUserId === input.approvedByUserId) return { allowed: false, statusCode: 409, code: 'facilities.disposal_independent_approval_required' };
  if (Number(input?.residualValue || 0) < 0 || !hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'facilities.disposal_value_or_evidence_invalid' };
  return { allowed: true, code: 'facilities.asset_dispose_allowed' };
});

module.exports = { SITE_CREATE_POLICY, SPACE_CREATE_POLICY, INSPECTION_COMPLETE_POLICY, TRANSFER_ACCEPT_POLICY, ASSET_DECOMMISSION_POLICY, ASSET_DISPOSE_POLICY };
