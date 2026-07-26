'use strict';

function evaluateQuota({ organisationId, integrationId, usage, limits }) {
  if (!organisationId || !integrationId) throw new Error('integration_usage.scope.required');
  const exceeded = [];
  for (const metric of ['requests', 'bytes', 'records']) {
    if (limits[metric] != null && (usage[metric] || 0) > limits[metric]) exceeded.push(metric);
  }
  return Object.freeze({ organisationId, integrationId, allowed: exceeded.length === 0, exceeded: Object.freeze(exceeded) });
}

function buildUsageEntry(entry) {
  const required = ['organisationId', 'integrationId', 'period', 'metric', 'quantity'];
  for (const field of required) if (entry[field] === undefined || entry[field] === null) throw new Error(`integration_usage.${field}.required`);
  if (entry.quantity < 0) throw new Error('integration_usage.quantity.invalid');
  if (entry.financialEntryId && entry.billable === true) throw new Error('integration_usage.double_billing_forbidden');
  return Object.freeze({ ...entry, version: 'integration-usage@1' });
}

module.exports = { evaluateQuota, buildUsageEntry };
