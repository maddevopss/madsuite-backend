'use strict';

const { buildCapacityBaseline } = require('../core/scaling/capacityBaseline');

describe('capacity baseline', () => {
  it('produces reproducible maxima and thresholds', () => {
    const result = buildCapacityBaseline([
      { volume: 100, throughput: 20, payloadBytes: 1000, processingMs: 80 },
      { volume: 200, throughput: 40, payloadBytes: 2000, processingMs: 120 },
    ]);
    expect(result.contract).toBe('capacity-baseline@1');
    expect(result.maxima.volume).toBe(200);
    expect(result.saturationThresholds.throughput).toBe(34);
  });

  it('rejects missing samples', () => {
    expect(() => buildCapacityBaseline([])).toThrow('capacity_samples_required');
  });
});
