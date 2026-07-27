'use strict';

const REQUIRED_BOOLEAN_CHECKS = Object.freeze([
  'configurationValidated',
  'migrationsValidated',
  'healthchecksValidated',
  'tenantIsolationValidated',
  'backupRestoreValidated',
  'rollbackValidated',
  'monitoringValidated',
]);

function evaluateProductionReadiness(input = {}) {
  const failures = [];

  for (const check of REQUIRED_BOOLEAN_CHECKS) {
    if (input[check] !== true) failures.push(check);
  }

  const criticalFindings = Number(input.unresolvedCriticalFindings || 0);
  if (!Number.isInteger(criticalFindings) || criticalFindings < 0) {
    failures.push('invalidCriticalFindingsCount');
  } else if (criticalFindings > 0) {
    failures.push('unresolvedCriticalFindings');
  }

  if (!input.evidence || typeof input.evidence !== 'object' || Array.isArray(input.evidence)) {
    failures.push('evidenceMissing');
  } else if (Object.keys(input.evidence).length === 0) {
    failures.push('evidenceMissing');
  }

  const approved = Boolean(input.approvedBy && input.approvedAt);
  if (!approved) failures.push('humanApprovalMissing');

  return Object.freeze({
    ready: failures.length === 0,
    failures: Object.freeze(failures),
    decisionAuthority: 'human',
  });
}

module.exports = {
  REQUIRED_BOOLEAN_CHECKS,
  evaluateProductionReadiness,
};
