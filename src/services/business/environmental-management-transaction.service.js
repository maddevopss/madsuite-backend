const { registerPolicy } = require("./transaction-engine.service");

const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const requireKey = (value) => hasText(value) && value.trim().length >= 8
  ? null
  : { allowed: false, statusCode: 400, code: "environment.idempotency_required" };

registerPolicy("environment.permit.register", "1", ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.permitType) || !hasText(input?.permitNumber) || !hasText(input?.issuingAuthority) || !input?.issuedAt || !input?.expiresAt) return { allowed: false, statusCode: 400, code: "environment.permit_fields_required" };
  if (new Date(input.expiresAt) < new Date(input.issuedAt)) return { allowed: false, statusCode: 409, code: "environment.permit_period_invalid" };
  if (!hasItems(input?.proofRefs)) return { allowed: false, statusCode: 409, code: "environment.permit_proof_required" };
  return { allowed: true, code: "environment.permit_register_allowed" };
});

registerPolicy("environment.incident.report", "1", ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.siteId || !input?.occurredAt || !hasText(input?.incidentType) || !hasText(input?.severity) || !hasText(input?.description) || !input?.responsibleUserId) return { allowed: false, statusCode: 400, code: "environment.incident_fields_required" };
  if (new Date(input.occurredAt) > new Date()) return { allowed: false, statusCode: 409, code: "environment.incident_future_date" };
  if (!hasItems(input?.proofRefs)) return { allowed: false, statusCode: 409, code: "environment.incident_proof_required" };
  return { allowed: true, code: "environment.incident_report_allowed" };
});

registerPolicy("environment.inspection.complete", "1", ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.siteId || !input?.inspectedAt || !input?.inspectorUserId || !hasItems(input?.scope)) return { allowed: false, statusCode: 400, code: "environment.inspection_fields_required" };
  if (new Date(input.inspectedAt) > new Date()) return { allowed: false, statusCode: 409, code: "environment.inspection_future_date" };
  if (!Array.isArray(input?.findings) || !hasItems(input?.proofRefs)) return { allowed: false, statusCode: 409, code: "environment.inspection_proof_required" };
  return { allowed: true, code: "environment.inspection_complete_allowed" };
});

registerPolicy("environment.corrective_action.close", "1", ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.actionId || !input?.closedBy) return { allowed: false, statusCode: 400, code: "environment.action_closure_fields_required" };
  if (!hasItems(input?.closureEvidence)) return { allowed: false, statusCode: 409, code: "environment.action_closure_proof_required" };
  return { allowed: true, code: "environment.action_close_allowed" };
});

registerPolicy("environment.metric.record", "1", ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.metricType) || !input?.periodStart || !input?.periodEnd || input?.value === undefined || !hasText(input?.unit) || !hasText(input?.methodology)) return { allowed: false, statusCode: 400, code: "environment.metric_fields_required" };
  if (new Date(input.periodEnd) < new Date(input.periodStart)) return { allowed: false, statusCode: 409, code: "environment.metric_period_invalid" };
  if (!hasItems(input?.sourceRefs)) return { allowed: false, statusCode: 409, code: "environment.metric_source_required" };
  return { allowed: true, code: "environment.metric_record_allowed" };
});

registerPolicy("environment.report.publish", "1", ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.periodStart || !input?.periodEnd || !hasText(input?.summary) || !input?.preparedBy || !input?.approvedBy) return { allowed: false, statusCode: 400, code: "environment.report_fields_required" };
  if (new Date(input.periodEnd) < new Date(input.periodStart)) return { allowed: false, statusCode: 409, code: "environment.report_period_invalid" };
  if (input.preparedBy === input.approvedBy) return { allowed: false, statusCode: 409, code: "environment.report_independent_approval_required" };
  if (!input?.indicators || !Array.isArray(input?.risks) || !hasItems(input?.proofRefs)) return { allowed: false, statusCode: 409, code: "environment.report_proof_required" };
  return { allowed: true, code: "environment.report_publish_allowed" };
});

module.exports = {
  PERMIT_REGISTER_POLICY: "environment.permit.register@1",
  INCIDENT_REPORT_POLICY: "environment.incident.report@1",
  INSPECTION_COMPLETE_POLICY: "environment.inspection.complete@1",
  ACTION_CLOSE_POLICY: "environment.corrective_action.close@1",
  METRIC_RECORD_POLICY: "environment.metric.record@1",
  REPORT_PUBLISH_POLICY: "environment.report.publish@1",
};
