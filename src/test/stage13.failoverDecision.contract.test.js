'use strict';

const { authorizeFailover, authorizeFailback } = require('../resilience/failoverDecision');

describe('stage 13C controlled failover', () => {
  test('blocks failover without fencing', () => {
    expect(() => authorizeFailover({ incidentId: 'inc-1', source: 'a', target: 'b', approvedBy: 'ops', sourceFenced: false, replicationHealthy: true })).toThrow('failover_source_not_fenced');
  });

  test('requires reconciliation before failback', () => {
    expect(() => authorizeFailback({ primaryHealthy: true, dataReconciled: false, approvedBy: 'ops' })).toThrow('failback_conditions_not_met');
  });
});
