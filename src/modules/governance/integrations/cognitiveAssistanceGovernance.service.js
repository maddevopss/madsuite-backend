'use strict';

function evaluateCognitiveRecommendation(input = {}) {
  const {
    organisationId,
    recommendationId,
    contextSources = [],
    policyIds = [],
    evidenceIds = [],
    confidence,
    explanation,
    limitations = [],
    humanConfirmationRequired = true,
    humanConfirmed = false,
  } = input;

  const reasons = [];
  const numericConfidence = Number(confidence);
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!recommendationId) reasons.push('RECOMMENDATION_REQUIRED');
  if (contextSources.length === 0) reasons.push('CONTEXT_PROVENANCE_REQUIRED');
  if (policyIds.length === 0) reasons.push('POLICY_REQUIRED');
  if (evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');
  if (!Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1) reasons.push('CONFIDENCE_OUT_OF_RANGE');
  if (!explanation || !String(explanation).trim()) reasons.push('EXPLANATION_REQUIRED');
  if (!Array.isArray(limitations)) reasons.push('LIMITATIONS_MUST_BE_ARRAY');
  if (humanConfirmationRequired && !humanConfirmed) reasons.push('HUMAN_CONFIRMATION_REQUIRED');

  return Object.freeze({
    executable: reasons.length === 0,
    advisoryOnly: true,
    reasons: Object.freeze(reasons),
    record: Object.freeze({
      organisationId,
      recommendationId,
      contextSources: Object.freeze([...contextSources]),
      policyIds: Object.freeze([...policyIds]),
      evidenceIds: Object.freeze([...evidenceIds]),
      confidence: numericConfidence,
      explanation,
      limitations: Object.freeze([...limitations]),
      humanConfirmed: Boolean(humanConfirmed),
    }),
  });
}

module.exports = { evaluateCognitiveRecommendation };
