'use strict';

const REQUIRED_CHECKS = Object.freeze([
  'planCatalogVerified',
  'entitlementsVerified',
  'quotasVerified',
  'billingVerified',
  'trialLifecycleVerified',
  'subscriptionLifecycleVerified',
  'tenantIsolationVerified',
  'administrationVerified',
  'supportVerified',
  'auditVerified',
]);

function evaluateSaasPlatformClosure(input = {}) {
  const failedChecks = REQUIRED_CHECKS.filter((name) => input[name] !== true);
  const humanApproval = Boolean(input.approvedBy && input.approvedAt);
  return {
    status: failedChecks.length === 0 && humanApproval ? 'closed' : 'open',
    allowed: failedChecks.length === 0 && humanApproval,
    failedChecks,
    humanApproval,
    evidence: input.evidence || {},
  };
}

module.exports = { REQUIRED_CHECKS, evaluateSaasPlatformClosure };