const service = require('../services/business/accounting-budget-variance.service');

describe('accounting budget variance', () => {
  test('returns unfavorable overspend as positive variance', () => {
    expect(service.calculateVariance({ budget: 1000, actual: 1250 })).toEqual({
      budget: 1000,
      actual: 1250,
      variance: 250,
      variancePercent: 25,
    });
  });

  test('handles zero budget without an invalid percentage', () => {
    expect(service.calculateVariance({ budget: 0, actual: 50 }).variancePercent).toBeNull();
  });
});
