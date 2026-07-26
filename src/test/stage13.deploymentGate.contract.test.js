'use strict';
const { authorizeDeployment, shouldAbortDeployment } = require('../resilience/deploymentGate');
describe('stage 13F deployment gates', () => {
  test('requires a tested rollback', () => {
    expect(() => authorizeDeployment({ strategy: 'canary', healthChecksPassed: true, rollbackTested: false, errorBudgetRemaining: 10, approvedBy: 'ops' })).toThrow('deployment_gate_rejected');
  });
  test('aborts on excessive errors', () => {
    expect(shouldAbortDeployment({ errorRate: 0.08, maxErrorRate: 0.02, latencyMs: 100, maxLatencyMs: 500, health: 'degraded' })).toBe(true);
  });
});
