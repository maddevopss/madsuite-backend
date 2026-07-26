'use strict';

const REQUIRED_PROOFS = Object.freeze([
  'catalog_complete',
  'classification_enforced',
  'lineage_reconstructed',
  'quality_thresholds_met',
  'retention_verified',
  'rights_request_executed',
  'tenant_isolation_proven',
  'residual_risks_documented'
]);

function closeDataGovernanceStage(proofs) {
  if (!proofs || typeof proofs !== 'object') throw new TypeError('proofs are required');
  const missing = REQUIRED_PROOFS.filter(proof => proofs[proof] !== true);
  return Object.freeze({
    stage: 14,
    closed: missing.length === 0,
    missing,
    statement: missing.length === 0
      ? 'Every governed data asset is identifiable, explainable and controllable.'
      : 'Closure refused because evidence is incomplete.'
  });
}

module.exports = { REQUIRED_PROOFS, closeDataGovernanceStage };
