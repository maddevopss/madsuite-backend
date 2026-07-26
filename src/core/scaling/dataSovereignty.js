'use strict';

function validateDataSovereignty(record = {}) {
  const required = ['dataset', 'primaryRegion', 'backupRegions', 'dependencies', 'restorePlan'];
  for (const field of required) if (!record[field]) throw new Error(`sovereignty_field_required:${field}`);
  if (!Array.isArray(record.backupRegions) || !Array.isArray(record.dependencies)) throw new Error('invalid_sovereignty_inventory');
  if (record.residencyClaim && !record.technicalEvidence) throw new Error('residency_claim_without_evidence');
  if (record.replicationEnabled && !record.replicationConsistency) throw new Error('replication_consistency_required');
  return { contract: 'data-sovereignty@1', documented: true, claimVerified: Boolean(record.technicalEvidence) };
}

module.exports = { validateDataSovereignty };
