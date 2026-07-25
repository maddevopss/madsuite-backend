const { registerPolicy } = require("./transaction-engine.service");

const required = (value) => value !== undefined && value !== null && value !== "";
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const notFuture = (value) => !value || new Date(value).getTime() <= Date.now();

const policies = [
  {
    name: "environment.permit.register@1",
    validate: ({ permitType, permitNumber, issuingAuthority, issuedAt, expiresAt, proofRefs }) => {
      if (![permitType, permitNumber, issuingAuthority, issuedAt, expiresAt].every(required)) return "ENVIRONMENT_PERMIT_INCOMPLETE";
      if (new Date(expiresAt) < new Date(issuedAt)) return "ENVIRONMENT_PERMIT_PERIOD_INVALID";
      if (!hasItems(proofRefs)) return "ENVIRONMENT_PERMIT_PROOF_REQUIRED";
      return null;
    },
  },
  {
    name: "environment.incident.report@1",
    validate: ({ siteId, occurredAt, incidentType, severity, description, responsibleUserId, proofRefs }) => {
      if (![siteId, occurredAt, incidentType, severity, description, responsibleUserId].every(required)) return "ENVIRONMENT_INCIDENT_INCOMPLETE";
      if (!notFuture(occurredAt)) return "ENVIRONMENT_INCIDENT_FUTURE_DATE";
      if (!hasItems(proofRefs)) return "ENVIRONMENT_INCIDENT_PROOF_REQUIRED";
      return null;
    },
  },
  {
    name: "environment.inspection.complete@1",
    validate: ({ inspectedAt, inspectorUserId, scope, findings, proofRefs }) => {
      if (![inspectedAt, inspectorUserId].every(required) || !hasItems(scope)) return "ENVIRONMENT_INSPECTION_INCOMPLETE";
      if (!notFuture(inspectedAt)) return "ENVIRONMENT_INSPECTION_FUTURE_DATE";
      if (!Array.isArray(findings) || !hasItems(proofRefs)) return "ENVIRONMENT_INSPECTION_PROOF_REQUIRED";
      return null;
    },
  },
  {
    name: "environment.corrective_action.close@1",
    validate: ({ actionId, closedBy, closureEvidence }) => {
      if (![actionId, closedBy].every(required)) return "ENVIRONMENT_ACTION_CLOSURE_INCOMPLETE";
      if (!hasItems(closureEvidence)) return "ENVIRONMENT_ACTION_CLOSURE_PROOF_REQUIRED";
      return null;
    },
  },
  {
    name: "environment.metric.record@1",
    validate: ({ metricType, periodStart, periodEnd, value, unit, methodology, sourceRefs }) => {
      if (![metricType, periodStart, periodEnd, value, unit, methodology].every(required)) return "ENVIRONMENT_METRIC_INCOMPLETE";
      if (new Date(periodEnd) < new Date(periodStart)) return "ENVIRONMENT_METRIC_PERIOD_INVALID";
      if (!hasItems(sourceRefs)) return "ENVIRONMENT_METRIC_SOURCE_REQUIRED";
      return null;
    },
  },
  {
    name: "environment.report.publish@1",
    validate: ({ periodStart, periodEnd, summary, indicators, risks, proofRefs, preparedBy, approvedBy }) => {
      if (![periodStart, periodEnd, summary, preparedBy, approvedBy].every(required)) return "ENVIRONMENT_REPORT_INCOMPLETE";
      if (new Date(periodEnd) < new Date(periodStart)) return "ENVIRONMENT_REPORT_PERIOD_INVALID";
      if (preparedBy === approvedBy) return "ENVIRONMENT_REPORT_SELF_APPROVAL";
      if (!indicators || !Array.isArray(risks) || !hasItems(proofRefs)) return "ENVIRONMENT_REPORT_PROOF_REQUIRED";
      return null;
    },
  },
];

for (const policy of policies) registerPolicy(policy.name, policy.validate);

module.exports = { policies };
