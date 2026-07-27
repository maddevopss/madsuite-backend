const service = require('../services/business/inventory-count.service');

describe('inventory count controls', () => {
  test('calculates quantity and value variances', () => {
    const result = service.calculateCountVariance([{ expectedQuantity: 10, countedQuantity: 8, unitCost: 12.5 }]);
    expect(result.totalVarianceQuantity).toBe(-2);
    expect(result.totalVarianceValue).toBe(-25);
    expect(result.exceptionCount).toBe(1);
  });

  test('requires a distinct approver before posting', () => {
    expect(service.canPostCount({ status: 'approved', submittedBy: 7, approvedBy: 8 })).toBe(true);
    expect(service.canPostCount({ status: 'approved', submittedBy: 7, approvedBy: 7 })).toBe(false);
  });
});
