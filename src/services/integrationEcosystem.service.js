'use strict';

const REQUIRED_CHECKS = Object.freeze([
  'deliveryVerified',
  'signatureVerified',
  'retryVerified',
  'idempotencyVerified',
  'reconciliationVerified',
  'tenantIsolationVerified',
  'auditVerified',
  'failureRecoveryVerified',
]);

function evaluateIntegrationReadiness(input = {}) {
  const failedChecks = REQUIRED_CHECKS.filter((name) => input[name] !== true);
  const humanApproval = Boolean(input.approvedBy && input.approvedAt);
  return {
    status: failedChecks.length === 0 && humanApproval ? 'active' : 'draft',
    allowed: failedChecks.length === 0 && humanApproval,
    failedChecks,
    humanApproval,
    evidence: input.evidence || {},
  };
}

module.exports = { REQUIRED_CHECKS, evaluateIntegrationReadiness };