const { assessCapability, assertCapabilityEnabled } = require('../ai/assistedCapabilityMonitor');

describe('stage 9G capability monitoring', () => {
  const thresholds = { minAcceptanceRate: 0.4, maxCorrectionRate: 0.3, minRefusalRate: 0.9, maxDriftScore: 0.2, maxP95LatencyMs: 3000, maxCostCad: 25 };
  test('stops a capability with multiple breaches', () => {
    const report = assessCapability({ useCaseId: 'billing-review', thresholds, metrics: { acceptanceRate: 0.2, correctionRate: 0.5, refusalRate: 1, driftScore: 0.1, p95LatencyMs: 1000, costCad: 10 } });
    expect(report.state).toBe('stopped');
    expect(() => assertCapabilityEnabled(report)).toThrow('ai.capability.controlled_stop');
  });
  test('allows a healthy capability', () => {
    const report = assessCapability({ useCaseId: 'billing-review', thresholds, metrics: { acceptanceRate: 0.8, correctionRate: 0.1, refusalRate: 1, driftScore: 0.1, p95LatencyMs: 1000, costCad: 10 } });
    expect(report.executionAllowed).toBe(true);
  });
});
