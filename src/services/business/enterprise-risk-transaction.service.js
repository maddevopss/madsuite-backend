const { registerPolicy } = require('./transaction-engine.service');

const RISK_CREATE_POLICY = 'risk.register.create@1';
const RISK_ASSESSMENT_POLICY = 'risk.assessment.record@1';
const RISK_CONTROL_TRANSITION_POLICY = 'risk.control.transition@1';
const RISK_TREATMENT_TRANSITION_POLICY = 'risk.treatment.transition@1';
const RISK_REVIEW_TRANSITION_POLICY = 'risk.review.transition@1';
const RISK_INCIDENT_POLICY = 'risk.incident.record@1';

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEvidence(value) {
  return Array.isArray(value) && value.length > 0;
}

function validIdempotency(value) {
  return hasText(value) && value.trim().length >= 8;
}

function validLevel(value) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 5;
}

function calculateRiskScore(likelihood, impact) {
  if (!validLevel(likelihood) || !validLevel(impact)) return null;
  return Number(likelihood) * Number(impact);
}

function calculateResidualScore(inherentScore, controlEffectiveness = 0) {
  const score = Number(inherentScore);
  const effectiveness = Number(controlEffectiveness);
  if (!Number.isFinite(score) || score < 0 || !Number.isFinite(effectiveness) || effectiveness < 0 || effectiveness > 100) return null;
  return Number((score * (1 - effectiveness / 100)).toFixed(2));
}

registerPolicy('risk.register.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'risk.idempotency_required' };
  if (!hasText(input?.riskNumber) || !hasText(input?.category) || !hasText(input?.title) || !hasText(input?.description)) return { allowed: false, statusCode: 400, code: 'risk.fields_required' };
  if (!input?.ownerUserId) return { allowed: false, statusCode: 400, code: 'risk.owner_required' };
  if (!validLevel(input?.likelihood) || !validLevel(input?.impact)) return { allowed: false, statusCode: 400, code: 'risk.assessment_level_invalid' };
  return { allowed: true, code: 'risk.create_allowed', score: calculateRiskScore(input.likelihood, input.impact) };
});

registerPolicy('risk.assessment.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'risk.idempotency_required' };
  if (!input?.riskId || !validLevel(input?.likelihood) || !validLevel(input?.impact)) return { allowed: false, statusCode: 400, code: 'risk.assessment_invalid' };
  if (!hasText(input?.conclusion)) return { allowed: false, statusCode: 400, code: 'risk.assessment_conclusion_required' };
  const inherentScore = calculateRiskScore(input.likelihood, input.impact);
  const residualScore = calculateResidualScore(inherentScore, input.controlEffectiveness || 0);
  if (residualScore === null) return { allowed: false, statusCode: 400, code: 'risk.control_effectiveness_invalid' };
  return { allowed: true, code: 'risk.assessment_allowed', inherentScore, residualScore };
});

registerPolicy('risk.control.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'risk.idempotency_required' };
  if (input?.action === 'active' && !hasEvidence(input?.verificationEvidence)) return { allowed: false, statusCode: 409, code: 'risk.control_evidence_required' };
  if (input?.action === 'retired' && !hasText(input?.reason)) return { allowed: false, statusCode: 400, code: 'risk.reason_required' };
  return { allowed: true, code: 'risk.control_transition_allowed' };
});

registerPolicy('risk.treatment.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'risk.idempotency_required' };
  if (['implemented', 'verified', 'closed'].includes(input?.action) && !hasEvidence(input?.evidence)) return { allowed: false, statusCode: 409, code: 'risk.treatment_evidence_required' };
  if (['verified', 'closed'].includes(input?.action) && !hasText(input?.result)) return { allowed: false, statusCode: 409, code: 'risk.treatment_result_required' };
  if (input?.action === 'cancelled' && !hasText(input?.reason)) return { allowed: false, statusCode: 400, code: 'risk.reason_required' };
  return { allowed: true, code: 'risk.treatment_transition_allowed' };
});

registerPolicy('risk.review.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'risk.idempotency_required' };
  if (['approved', 'closed'].includes(input?.action) && (!hasText(input?.conclusion) || !hasEvidence(input?.evidence))) return { allowed: false, statusCode: 409, code: 'risk.review_proof_required' };
  if (input?.action === 'approved' && !input?.nextReviewAt) return { allowed: false, statusCode: 400, code: 'risk.next_review_required' };
  return { allowed: true, code: 'risk.review_transition_allowed' };
});

registerPolicy('risk.incident.record', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'risk.idempotency_required' };
  if (!hasText(input?.incidentNumber) || !hasText(input?.sourceType) || !hasText(input?.title) || !hasText(input?.description)) return { allowed: false, statusCode: 400, code: 'risk.incident_fields_required' };
  if (input?.severity === 'critical' && !hasEvidence(input?.evidence)) return { allowed: false, statusCode: 409, code: 'risk.critical_incident_evidence_required' };
  return { allowed: true, code: 'risk.incident_allowed' };
});

module.exports = {
  RISK_CREATE_POLICY,
  RISK_ASSESSMENT_POLICY,
  RISK_CONTROL_TRANSITION_POLICY,
  RISK_TREATMENT_TRANSITION_POLICY,
  RISK_REVIEW_TRANSITION_POLICY,
  RISK_INCIDENT_POLICY,
  calculateRiskScore,
  calculateResidualScore,
  validLevel,
};
