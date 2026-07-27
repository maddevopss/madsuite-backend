const service = require('../services/business/inventory-analytics.service');

function dbWith(sequence) {
  return { query: jest.fn(async () => sequence.shift() || { rows: [], rowCount: 0 }) };
}

describe('inventory analytics service', () => {
  test('arrondit une commande au multiple supérieur', () => {
    expect(service.orderToMultiple(11, 5, 1)).toBe(15);
    expect(service.orderToMultiple(2, 5, 10)).toBe(10);
  });

  test('crée un instantané de valorisation avec transaction source', async () => {
    const db = dbWith([
      {},
      { rows: [{ max_id: 99 }] },
      { rows: [{ item_id: 1, quantity: '4', inventory_value: '40' }] },
      {},
    ]);
    const result = await service.createValuationSnapshot(db, 8, 4, { snapshotDate: '2026-07-27' });
    expect(result.snapshotDate).toBe('2026-07-27');
    expect(result.rows).toHaveLength(1);
    expect(db.query).toHaveBeenLastCalledWith('COMMIT');
  });

  test('retourne la rotation et les jours de stock calculés par PostgreSQL', async () => {
    const db = dbWith([{ rows: [{ item_id: 1, average_daily_usage: '2.000000', days_of_stock: '5.00' }] }]);
    const result = await service.movementAnalytics(db, 8, { days: 30, itemId: 1 });
    expect(result.horizonDays).toBe(30);
    expect(result.rows[0].days_of_stock).toBe('5.00');
  });

  test('calcule une suggestion explicable avec stock de sécurité', async () => {
    const db = dbWith([
      { rows: [{ item_id: 1, location_id: 2, quantity_on_hand: '5', average_daily_usage: '2', issue_count: 20 }] },
      { rows: [{ item_id: 1, location_id: 2, lead_time_days: 3, review_period_days: 4, safety_stock: '2', minimum_order_quantity: '5', order_multiple: '5' }] },
      { rows: [{ inbound: '0' }] },
      { rows: [{ id: 77, suggested_quantity: '15', confidence: '1.0000' }] },
    ]);
    const suggestions = await service.calculateSuggestions(db, 8, 4, { days: 30 });
    expect(suggestions[0].id).toBe(77);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('inventory_replenishment_suggestions'));
    expect(insert[1][9]).toBe(15);
    expect(JSON.parse(insert[1][12]).formula).toContain('lead+review');
  });

  test('génère un CSV de valorisation', async () => {
    const db = dbWith([{ rows: [{ snapshot_date: '2026-07-27', sku: 'A-1', item_name: 'Article', location_code: 'MAIN', quantity: '2', average_cost: '5', inventory_value: '10' }] }]);
    const csv = await service.exportValuationCsv(db, 8, '2026-07-27');
    expect(csv).toContain('"A-1"');
    expect(csv).toContain('"10"');
  });
});
