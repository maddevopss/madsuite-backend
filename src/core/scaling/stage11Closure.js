'use strict';

const REQUIRED_PROOFS = [
  'capacityLoadTest',
  'progressiveScaleTest',
  'projectionRebuild',
  'versionMigrationSimulation',
  'dataSovereigntyReview',
  'consumerRetirementScan',
];

function evaluateStage11Closure(report = {}) {
  const missing = REQUIRED_PROOFS.filter(proof => report[proof] !== true);
  const residualRisksAccepted = Array.isArray(report.residualRisks)
    && report.residualRisks.every(risk => risk.owner && risk.decision && risk.reviewDate);
  const limitsDocumented = Array.isArray(report.knownLimits) && report.knownLimits.length > 0;
  return {
    contract: 'stage11-closure@1',
    closed: missing.length === 0 && residualRisksAccepted && limitsDocumented,
    missing,
    residualRisksAccepted,
    limitsDocumented,
    nextArchitectureDecisions: report.nextArchitectureDecisions || [],
  };
}

module.exports = { evaluateStage11Closure, REQUIRED_PROOFS };
