const service = require('../services/business/accounting-fixed-assets.service');

describe('accounting fixed assets', () => {
  test('calculates straight-line monthly depreciation', () => {
    expect(service.calculateStraightLineMonthlyDepreciation({
      acquisition_cost: 12000,
      residual_value: 1200,
      useful_life_months: 60,
    })).toBe(180);
  });

  test('rejects a residual value above acquisition cost', () => {
    expect(() => service.calculateStraightLineMonthlyDepreciation({
      acquisition_cost: 1000,
      residual_value: 1200,
      useful_life_months: 12,
    })).toThrow("valeur résiduelle");
  });
});
