'use strict';

function defineReplicationPolicy(input) {
  const required = ['resource', 'mode', 'maxLagSeconds', 'maxDataLossSeconds', 'conflictStrategy'];
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`replication_${field}_required`);
  if (!['synchronous', 'asynchronous'].includes(input.mode)) throw new Error('replication_invalid_mode');
  if (input.maxLagSeconds < 0 || input.maxDataLossSeconds < 0) throw new Error('replication_invalid_threshold');
  if (input.mode === 'asynchronous' && input.maxDataLossSeconds === 0) throw new Error('replication_unproven_zero_loss');
  return Object.freeze({ ...input, version: 1 });
}

function evaluateReplicationHealth(policy, observation) {
  return Object.freeze({
    healthy: observation.lagSeconds <= policy.maxLagSeconds && observation.estimatedDataLossSeconds <= policy.maxDataLossSeconds,
    lagSeconds: observation.lagSeconds,
    estimatedDataLossSeconds: observation.estimatedDataLossSeconds,
    observedAt: observation.observedAt,
  });
}

module.exports = { defineReplicationPolicy, evaluateReplicationHealth };
