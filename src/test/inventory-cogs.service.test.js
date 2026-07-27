const service = require('../services/business/inventory-cogs.service');

describe('inventory accounting postings', () => {
  test('builds a balanced issue posting', () => {
    const posting = service.buildInventoryPosting({ postingType: 'issue', quantity: 3, unitCost: 8.5, inventoryAccountId: 1, offsetAccountId: 2 });
    expect(posting.amount).toBe(25.5);
    expect(posting.direction).toBe('decrease');
    expect(service.isBalanced(posting.lines)).toBe(true);
  });

  test('rejects invalid quantities', () => {
    expect(() => service.buildInventoryPosting({ postingType: 'receipt', quantity: 0, unitCost: 8 })).toThrow();
  });
});
