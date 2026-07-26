'use strict';

const { defineReplicationPolicy, evaluateReplicationHealth } = require('../resilience/replicationPolicy');

describe('stage 13B replication policy', () => {
  test('rejects unproven zero-loss async replication', () => {
    expect(() => defineReplicationPolicy({ resource: 'ledger', mode: 'asynchronous', maxLagSeconds: 5, maxDataLossSeconds: 0, conflictStrategy: 'single-writer' })).toThrow('replication_unproven_zero_loss');
  });

  test('exposes unhealthy lag', () => {
    const policy = defineReplicationPolicy({ resource: 'events', mode: 'asynchronous', maxLagSeconds: 5, maxDataLossSeconds: 10, conflictStrategy: 'single-writer' });
    expect(evaluateReplicationHealth(policy, { lagSeconds: 8, estimatedDataLossSeconds: 2, observedAt: '2026-07-26T00:00:00Z' }).healthy).toBe(false);
  });
});
