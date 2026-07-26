const thresholds = {
  registryP95Ms: 750,
  summaryP95Ms: 1200,
  errorRatePercent: 1,
  maxPageSize: 100,
};

function assessPerformance(sample) {
  return {
    registry: sample.registryP95Ms <= thresholds.registryP95Ms,
    summary: sample.summaryP95Ms <= thresholds.summaryP95Ms,
    errors: sample.errorRatePercent <= thresholds.errorRatePercent,
    pagination: sample.pageSize <= thresholds.maxPageSize,
  };
}

describe('stage7 performance thresholds', () => {
  test('accepts a healthy preproduction sample', () => {
    expect(Object.values(assessPerformance({ registryP95Ms: 500, summaryP95Ms: 900, errorRatePercent: 0.2, pageSize: 50 })).every(Boolean)).toBe(true);
  });
  test('does not hide functional errors behind latency results', () => {
    expect(assessPerformance({ registryP95Ms: 100, summaryP95Ms: 100, errorRatePercent: 4, pageSize: 20 }).errors).toBe(false);
  });
});

module.exports = { thresholds, assessPerformance };
