const service = require('../services/business/accounting-consolidation.service');

describe('accounting consolidation', () => {
  test('subtracts eliminations from member totals', () => {
    expect(service.calculateNetConsolidatedTotal({
      memberTotals: [1000, 700],
      eliminations: [200, 50],
    })).toEqual({ gross: 1700, eliminated: 250, net: 1450 });
  });
});
