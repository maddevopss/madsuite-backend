'use strict';

const REQUIRED_EVIDENCE = Object.freeze([
  'componentFailureDetected',
  'databaseFailureContained',
  'regionalFailureContained',
  'backupRestored',
  'failoverCompleted',
  'failbackCompleted',
  'noSilentDataLoss',
  'serviceStateCommunicated',
]);

function assessResilienceClosure(evidence) {
  const missing = REQUIRED_EVIDENCE.filter((key) => evidence[key] !== true);
  return Object.freeze({
    closed: missing.length === 0,
    missing,
    limits: Array.isArray(evidence.limits) ? evidence.limits : [],
    residualRisks: Array.isArray(evidence.residualRisks) ? evidence.residualRisks : [],
    assessedAt: evidence.assessedAt || new Date().toISOString(),
  });
}

module.exports = { REQUIRED_EVIDENCE, assessResilienceClosure };
