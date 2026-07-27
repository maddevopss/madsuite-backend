const control = require('../services/business/inventory-control.service');
const inventoryTransactionService = require('../services/business/inventory-transaction.service');

jest.mock('../services/business/inventory-transaction.service', () => ({
  postInventoryTransaction: jest.fn(),
}));

function dbWith(sequence) {
  return { query: jest.fn(async () => sequence.shift()) };
}

describe('inventory-control.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normalise seulement les quantités positives', () => {
    expect(control.positiveQuantity('2.3456')).toBe(2.346);
    expect(control.positiveQuantity(0)).toBeNull();
    expect(control.positiveQuantity(-1)).toBeNull();
  });

  test('retourne la disponibilité calculée côté serveur', async () => {
    const db = dbWith([{ rows: [{ item_id: 1, quantity_on_hand: '10', quantity_reserved: '3', quantity_available: '7' }] }]);
    const rows = await control.getAvailability(db, 8, { itemId: 1, locationId: 2 });
    expect(rows[0].quantity_available).toBe('7');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('quantity_available'), [8, 1, 2]);
  });

  test('refuse une réservation supérieure au disponible', async () => {
    const db = dbWith([
      { rows: [] },
      { rows: [{ quantity: '5' }] },
      { rows: [{ quantity: '2' }] },
      { rows: [] },
    ]);
    await expect(control.reserveStock(db, 8, 4, {
      itemId: 1,
      locationId: 2,
      quantity: 4,
      referenceType: 'sales_order',
      referenceId: 'SO-1',
      idempotencyKey: 'reserve-so-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  test('crée une réservation idempotente et retourne le disponible restant', async () => {
    const db = dbWith([
      { rows: [] },
      { rows: [{ quantity: '10' }] },
      { rows: [{ quantity: '2' }] },
      { rows: [{ id: 77, quantity: '3', status: 'active' }] },
      { rows: [] },
    ]);
    const result = await control.reserveStock(db, 8, 4, {
      itemId: 1,
      locationId: 2,
      quantity: 3,
      referenceType: 'sales_order',
      referenceId: 'SO-1',
      idempotencyKey: 'reserve-so-1',
    });
    expect(result.duplicate).toBe(false);
    expect(result.availability).toEqual({ quantityOnHand: 10, quantityReserved: 5, quantityAvailable: 5 });
  });

  test('empêche le préparateur d’approuver son propre comptage', async () => {
    const db = dbWith([{ rows: [{ id: 9, location_id: 2, submitted_by: 4, code: 'COUNT-1' }] }]);
    await expect(control.approveCountSession(db, 8, 4, 9, { idempotencyPrefix: 'count-approve-9' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('génère un ajustement par ligne en écart lors de l’approbation', async () => {
    const db = dbWith([
      { rows: [{ id: 9, location_id: 2, submitted_by: 3, code: 'COUNT-1' }] },
      { rows: [
        { id: 10, item_id: 1, variance_quantity: '2', unit_cost: '4.50' },
        { id: 11, item_id: 2, variance_quantity: '-1', unit_cost: '8.00' },
        { id: 12, item_id: 3, variance_quantity: '0', unit_cost: '1.00' },
      ] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 9, status: 'approved' }] },
    ]);
    inventoryTransactionService.postInventoryTransaction
      .mockResolvedValueOnce({ inventoryTransaction: { id: 101 } })
      .mockResolvedValueOnce({ inventoryTransaction: { id: 102 } });

    const result = await control.approveCountSession(db, 8, 4, 9, { idempotencyPrefix: 'count-approve-9' });
    expect(result.adjustments).toHaveLength(2);
    expect(inventoryTransactionService.postInventoryTransaction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'adjustment', direction: 'increase', quantity: 2, referenceType: 'inventory_count_session',
    }));
    expect(inventoryTransactionService.postInventoryTransaction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'adjustment', direction: 'decrease', quantity: 1,
    }));
  });
});
