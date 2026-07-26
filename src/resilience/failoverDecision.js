'use strict';

function authorizeFailover(input) {
  const required = ['incidentId', 'source', 'target', 'approvedBy', 'sourceFenced', 'replicationHealthy'];
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`failover_${field}_required`);
  if (!input.sourceFenced) throw new Error('failover_source_not_fenced');
  if (!input.replicationHealthy) throw new Error('failover_replication_unhealthy');
  if (input.source === input.target) throw new Error('failover_target_equals_source');
  return Object.freeze({ ...input, authorized: true, authorizedAt: new Date().toISOString() });
}

function authorizeFailback(input) {
  if (!input.primaryHealthy || !input.dataReconciled || !input.approvedBy) throw new Error('failback_conditions_not_met');
  return Object.freeze({ ...input, authorized: true });
}

module.exports = { authorizeFailover, authorizeFailback };
