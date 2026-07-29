'use strict';

function buildFinancialExplanation(input = {}) {
  const { organisationId, metric, previousValue, currentValue, causes = [], decisionIds = [], evidenceIds = [], riskFlags = [] } = input;
  const reasons = [];
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!metric) reasons.push('METRIC_REQUIRED');
  if (!Number.isFinite(Number(previousValue)) || !Number.isFinite(Number(currentValue))) reasons.push('NUMERIC_VALUES_REQUIRED');
  if (!Array.isArray(causes) || causes.length === 0) reasons.push('CAUSES_REQUIRED');
  if (evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');

  const delta = Number(currentValue) - Number(previousValue);
  const variationPercent = Number(previousValue) === 0 ? null : (delta / Math.abs(Number(previousValue))) * 100;

  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze(reasons),
    explanation: Object.freeze({
      organisationId,
      metric,
      previousValue: Number(previousValue),
      currentValue: Number(currentValue),
      delta,
      variationPercent,
      causes: Object.freeze([...causes]),
      decisionIds: Object.freeze([...decisionIds]),
      evidenceIds: Object.freeze([...evidenceIds]),
      riskFlags: Object.freeze([...riskFlags]),
    }),
  });
}

module.exports = { buildFinancialExplanation };
