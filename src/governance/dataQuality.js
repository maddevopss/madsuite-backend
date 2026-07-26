'use strict';

const DIMENSIONS = ['completeness', 'consistency', 'uniqueness', 'validity', 'freshness'];

function evaluateDataQuality({ assetId, scores, thresholds, owner, sensitiveDecision = false }) {
  if (!assetId || !owner) throw new Error('assetId and owner are required');
  const failures = DIMENSIONS.filter(d => typeof scores?.[d] !== 'number' || typeof thresholds?.[d] !== 'number' || scores[d] < thresholds[d]);
  return Object.freeze({ assetId, owner, scores, thresholds, failures, acceptable: failures.length === 0, sensitiveDecisionAllowed: !sensitiveDecision || failures.length === 0 });
}

function requireQualityForSensitiveDecision(result) {
  if (!result?.sensitiveDecisionAllowed) throw new Error(`data quality insufficient: ${result?.failures?.join(',')}`);
  return true;
}

module.exports = { DIMENSIONS, evaluateDataQuality, requireQualityForSensitiveDecision };
