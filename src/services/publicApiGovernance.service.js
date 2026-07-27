'use strict';

const REQUIRED_CHECKS = Object.freeze([
  'authenticationVerified',
  'authorizationVerified',
  'tenantIsolationVerified',
  'rateLimitsVerified',
  'idempotencyVerified',
  'versioningVerified',
  'documentationVerified',
  'compatibilityVerified',
  'auditVerified',
]);

function evaluatePublicApiReadiness(input = {}) {
  const checks = REQUIRED_CHECKS.map((name) => ({ name, passed: input[name] === true }));
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
  const humanApproval = Boolean(input.approvedBy && input.approvedAt);

  return {
    status: failedChecks.length === 0 && humanApproval ? 'active' : 'draft',
    allowed: failedChecks.length === 0 && humanApproval,
    failedChecks,
    humanApproval,
    evidence: input.evidence || {},
  };
}

module.exports = { REQUIRED_CHECKS, evaluatePublicApiReadiness };