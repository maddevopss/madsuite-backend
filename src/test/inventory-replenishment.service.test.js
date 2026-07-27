const service = require('../services/business/inventory-replenishment.service');

describe('inventory replenishment', () => {
  test('suggests enough stock to restore the target', () => {
    expect(service.calculateSuggestedQuantity({ quantityOnHand: 4, quantityReserved: 2, quantityOnOrder: 0, reorderPoint: 5, safetyStock: 2, reorderQuantity: 10 })).toBe(15);
  });

  test('does not reorder above the threshold', () => {
    expect(service.calculateSuggestedQuantity({ quantityOnHand: 12, reorderPoint: 5, reorderQuantity: 10 })).toBe(0);
  });
});
