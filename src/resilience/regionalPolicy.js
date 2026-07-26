'use strict';

function defineRegionalPolicy(input) {
  const required = ['organisationId', 'primaryRegion', 'allowedRegions', 'dataResidency', 'replicationMode', 'routingMode'];
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`regional_${field}_required`);
  if (!Array.isArray(input.allowedRegions) || !input.allowedRegions.includes(input.primaryRegion)) throw new Error('regional_primary_not_allowed');
  if (!input.allowedRegions.every((region) => input.dataResidency.includes(region))) throw new Error('regional_residency_violation');
  return Object.freeze({ ...input, version: 1 });
}

function authorizeRegionalActivation(policy, evidence) {
  if (!evidence.replicationVerified || !evidence.restoreVerified || !evidence.routingVerified || !evidence.approvedBy) throw new Error('regional_activation_not_proven');
  return Object.freeze({ organisationId: policy.organisationId, activated: true, evidence });
}

module.exports = { defineRegionalPolicy, authorizeRegionalActivation };
