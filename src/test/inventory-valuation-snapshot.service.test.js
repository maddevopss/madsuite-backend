const service = require('../services/business/inventory-valuation-snapshot.service');

describe('inventory valuation snapshots', () => {
  test('summarizes value and counts', () => {
    const snapshot = service.buildSnapshot([
      { itemId: 1, locationId: 10, quantity: 2, inventoryValue: 20 },
      { itemId: 2, locationId: 10, quantity: 3, inventoryValue: 45 },
    ], { asOfDate: '2026-07-27' });
    expect(snapshot.totalQuantity).toBe(5);
    expect(snapshot.totalValue).toBe(65);
    expect(snapshot.itemCount).toBe(2);
    expect(snapshot.locationCount).toBe(1);
  });

  test('produces a stable source hash', () => {
    const rows = [{ itemId: 1, locationId: 1, quantity: 1, inventoryValue: 4 }];
    expect(service.buildSnapshot(rows, {}).sourceHash).toBe(service.buildSnapshot(rows, {}).sourceHash);
  });
});
