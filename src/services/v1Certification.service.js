'use strict';

const REQUIRED_CHECKS = Object.freeze([
  'architectureVerified',
  'securityVerified',
  'tenantIsolationVerified',
  'dataIntegrityVerified',
  'operationsVerified',
  'backupRestoreVerified',
  'rollbackVerified',
  'documentationVerified',
  'complianceVerified',
  'releaseCandidateVerified',
]);

function evaluateV1Certification(input = {}) {
  const failedChecks = REQUIRED_CHECKS.filter((name) => input[name] !== true);
  const releaseIdentified = Boolean(input.releaseVersion && input.sourceCommit);
  const humanApproval = Boolean(input.approvedBy && input.approvedAt);
  const certified = failedChecks.length === 0 && releaseIdentified && humanApproval;

  return {
    decision: certified ? 'certified' : 'pending',
    certified,
    failedChecks,
    releaseIdentified,
    humanApproval,
    evidence: input.evidence || {},
  };
}

module.exports = { REQUIRED_CHECKS, evaluateV1Certification };