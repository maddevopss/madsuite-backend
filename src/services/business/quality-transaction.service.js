const { evaluatePolicy } = require("./transaction-engine.service");

const hasEvidence = (value) => Array.isArray(value) && value.length > 0;
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;

const QUALITY_PLAN_POLICY = {
  id: "quality.plan.create@1",
  decide: ({ input, idempotencyKey }) => {
    if (!validIdempotency(idempotencyKey)) return { allowed: false, code: "quality.idempotency_required" };
    if (!hasText(input?.code) || !hasText(input?.title) || !hasText(input?.scopeType) || !hasText(input?.version)) return { allowed: false, code: "quality.plan_fields_required" };
    if (!Array.isArray(input?.acceptanceCriteria) || input.acceptanceCriteria.length === 0) return { allowed: false, code: "quality.acceptance_criteria_required" };
    return { allowed: true, code: "quality.plan_allowed" };
  },
};

const QUALITY_PLAN_TRANSITION_POLICY = {
  id: "quality.plan.transition@1",
  decide: ({ input, idempotencyKey }) => {
    if (!validIdempotency(idempotencyKey)) return { allowed: false, code: "quality.idempotency_required" };
    if (["approved", "active"].includes(input?.action) && !hasEvidence(input?.evidence)) return { allowed: false, code: "quality.approval_evidence_required" };
    if (input?.action === "retired" && !hasText(input?.reason)) return { allowed: false, code: "quality.reason_required" };
    return { allowed: true, code: "quality.plan_transition_allowed" };
  },
};

const INSPECTION_POLICY = {
  id: "quality.inspection.record@1",
  decide: ({ input, idempotencyKey }) => {
    if (!validIdempotency(idempotencyKey)) return { allowed: false, code: "quality.idempotency_required" };
    if (!hasText(input?.inspectionNumber) || !hasText(input?.subjectType) || !hasText(String(input?.subjectId || ""))) return { allowed: false, code: "quality.inspection_fields_required" };
    if ([input?.sampleSize, input?.acceptedQuantity, input?.rejectedQuantity].some((value) => Number(value || 0) < 0)) return { allowed: false, code: "quality.quantity_invalid" };
    if (["accepted", "conditionally_accepted", "rejected"].includes(input?.result) && !hasEvidence(input?.evidence)) return { allowed: false, code: "quality.inspection_evidence_required" };
    if (["conditionally_accepted", "rejected"].includes(input?.result) && !hasText(input?.reason)) return { allowed: false, code: "quality.inspection_reason_required" };
    return { allowed: true, code: "quality.inspection_allowed" };
  },
};

const NONCONFORMITY_TRANSITION_POLICY = {
  id: "quality.nonconformity.transition@1",
  decide: ({ input, idempotencyKey }) => {
    if (!validIdempotency(idempotencyKey)) return { allowed: false, code: "quality.idempotency_required" };
    if (input?.action === "contained" && !hasText(input?.containmentAction)) return { allowed: false, code: "quality.containment_required" };
    if (["verified", "closed"].includes(input?.action) && !hasEvidence(input?.evidence)) return { allowed: false, code: "quality.verification_evidence_required" };
    if (["closed", "cancelled"].includes(input?.action) && !hasText(input?.reason)) return { allowed: false, code: "quality.reason_required" };
    return { allowed: true, code: "quality.nonconformity_transition_allowed" };
  },
};

const CORRECTIVE_ACTION_TRANSITION_POLICY = {
  id: "quality.corrective_action.transition@1",
  decide: ({ input, idempotencyKey }) => {
    if (!validIdempotency(idempotencyKey)) return { allowed: false, code: "quality.idempotency_required" };
    if (input?.action === "implemented" && !hasEvidence(input?.implementationEvidence)) return { allowed: false, code: "quality.implementation_evidence_required" };
    if (["effectiveness_verified", "closed"].includes(input?.action) && !hasEvidence(input?.effectivenessEvidence)) return { allowed: false, code: "quality.effectiveness_evidence_required" };
    if (input?.action === "effectiveness_verified" && !hasText(input?.effectivenessResult)) return { allowed: false, code: "quality.effectiveness_result_required" };
    if (["closed", "cancelled"].includes(input?.action) && !hasText(input?.reason)) return { allowed: false, code: "quality.reason_required" };
    return { allowed: true, code: "quality.corrective_action_transition_allowed" };
  },
};

const AUDIT_TRANSITION_POLICY = {
  id: "quality.audit.transition@1",
  decide: ({ input, idempotencyKey }) => {
    if (!validIdempotency(idempotencyKey)) return { allowed: false, code: "quality.idempotency_required" };
    if (input?.action === "completed" && (!hasEvidence(input?.evidence) || !hasText(input?.conclusion))) return { allowed: false, code: "quality.audit_completion_evidence_required" };
    if (["closed", "cancelled"].includes(input?.action) && !hasText(input?.reason)) return { allowed: false, code: "quality.reason_required" };
    return { allowed: true, code: "quality.audit_transition_allowed" };
  },
};

async function decide(policy, input, idempotencyKey) {
  return evaluatePolicy({ policy, input, idempotencyKey });
}

module.exports = {
  QUALITY_PLAN_POLICY,
  QUALITY_PLAN_TRANSITION_POLICY,
  INSPECTION_POLICY,
  NONCONFORMITY_TRANSITION_POLICY,
  CORRECTIVE_ACTION_TRANSITION_POLICY,
  AUDIT_TRANSITION_POLICY,
  hasEvidence,
  validIdempotency,
  decide,
};
