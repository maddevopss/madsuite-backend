'use strict';

const REQUIRED_POST_DEPLOY_CHECKS = Object.freeze([
  'health',
  'database',
  'migrations',
  'tenantIsolation',
  'criticalFlows',
  'backgroundJobs',
  'alerts',
]);

function evaluateControlledPublication(input = {}) {
  const missingChecks = REQUIRED_POST_DEPLOY_CHECKS.filter(
    (check) => input.postDeployChecks?.[check] !== true,
  );

  const blockers = [];
  if (!input.readinessGateApproved) blockers.push('readiness_gate_not_approved');
  if (!input.releaseIdentifier) blockers.push('release_identifier_missing');
  if (!input.sourceCommitSha) blockers.push('source_commit_missing');
  if (!input.rollbackPlanVerified) blockers.push('rollback_plan_not_verified');
  if (!input.evidenceComplete) blockers.push('evidence_incomplete');
  if (missingChecks.length) blockers.push('post_deploy_checks_incomplete');
  if (input.criticalIncidentOpen) blockers.push('critical_incident_open');

  const technicallyComplete = blockers.length === 0;
  const humanApprovalPresent = Boolean(input.approvedBy && input.approvedAt);

  return {
    allowed: technicallyComplete && humanApprovalPresent,
    technicallyComplete,
    humanApprovalPresent,
    missingChecks,
    blockers: humanApprovalPresent ? blockers : [...blockers, 'human_approval_missing'],
    recommendedStatus: technicallyComplete && humanApprovalPresent ? 'completed' : 'verifying',
  };
}

module.exports = {
  REQUIRED_POST_DEPLOY_CHECKS,
  evaluateControlledPublication,
};
