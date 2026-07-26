'use strict';

function authorizeDeployment(input) {
  const required = ['strategy', 'healthChecksPassed', 'rollbackTested', 'errorBudgetRemaining', 'approvedBy'];
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`deployment_${field}_required`);
  if (!['rolling', 'blue_green', 'canary'].includes(input.strategy)) throw new Error('deployment_invalid_strategy');
  if (!input.healthChecksPassed || !input.rollbackTested || input.errorBudgetRemaining <= 0) throw new Error('deployment_gate_rejected');
  return Object.freeze({ ...input, authorized: true });
}

function shouldAbortDeployment(observation) {
  return observation.errorRate > observation.maxErrorRate || observation.latencyMs > observation.maxLatencyMs || observation.health === 'critical';
}

module.exports = { authorizeDeployment, shouldAbortDeployment };
