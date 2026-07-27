jest.mock('../../../db', () => ({ connect: jest.fn() }));

const pool = require('../../../db');
const service = require('../services/business/inventory-traceability.service');

function clientWith(sequence) {
  return {
    query: jest.fn(async () => sequence.shift() || { rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

describe('inventory traceability contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('refuse un article suivi par série sans un numéro par unité', async () => {
    const client = clientWith([
      {},
      { rows: [] },
      { rows: [{ id: 10, tracking_mode: 'serial', is_active: true }] },
      { rows: [{ id: 2 }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(service.receiveTrackedStock({
      organisationId: 1,
      actorUserId: 7,
      itemId: 10,
      locationId: 2,
      quantity: 2,
      serialNumbers: ['SN-1'],
      idempotencyKey: 'tracked-receipt-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  test('crée un lot et augmente son solde', async () => {
    const client = clientWith([
      {},
      { rows: [] },
      { rows: [{ id: 10, tracking_mode: 'lot', is_active: true }] },
      { rows: [{ id: 2 }] },
      { rows: [{ id: 30, item_id: 10, lot_number: 'LOT-30', status: 'available', expires_at: '2099-01-01' }] },
      {},
      { rows: [{ id: 50, event_type: 'received', quantity: '5.000' }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await service.receiveTrackedStock({
      organisationId: 1,
      actorUserId: 7,
      itemId: 10,
      locationId: 2,
      quantity: 5,
      lotNumber: 'LOT-30',
      expiresAt: '2099-01-01',
      unitCost: 12.5,
      idempotencyKey: 'tracked-receipt-lot-30',
    });

    expect(result.duplicate).toBe(false);
    expect(result.lot.id).toBe(30);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('inventory_lot_balances'))).toBe(true);
  });

  test('rend une réception suivie idempotente', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: 50, idempotency_key: 'tracked-receipt-lot-30' }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await service.receiveTrackedStock({
      organisationId: 1,
      itemId: 10,
      locationId: 2,
      quantity: 5,
      lotNumber: 'LOT-30',
      idempotencyKey: 'tracked-receipt-lot-30',
    });

    expect(result.duplicate).toBe(true);
  });

  test('bloque une sortie sur un lot en quarantaine', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: 10, tracking_mode: 'lot' }] },
      { rows: [{ id: 30, item_id: 10, status: 'quarantined', quantity: '8', reserved_quantity: '0' }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(service.issueTrackedStock({
      organisationId: 1,
      itemId: 10,
      locationId: 2,
      lotId: 30,
      quantity: 1,
      idempotencyKey: 'tracked-issue-lot-30',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('bloque une sortie sur un lot expiré', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: 10, tracking_mode: 'lot' }] },
      { rows: [{ id: 30, item_id: 10, status: 'available', expires_at: '2020-01-01', quantity: '8', reserved_quantity: '0' }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(service.issueTrackedStock({
      organisationId: 1,
      itemId: 10,
      locationId: 2,
      lotId: 30,
      quantity: 1,
      idempotencyKey: 'tracked-issue-expired-30',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('sort uniquement les numéros de série explicitement demandés', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: 10, tracking_mode: 'serial' }] },
      { rows: [
        { id: 101, serial_number: 'SN-101', status: 'available' },
        { id: 102, serial_number: 'SN-102', status: 'available' },
      ] },
      {},
      { rows: [{ id: 60, event_type: 'issued' }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await service.issueTrackedStock({
      organisationId: 1,
      itemId: 10,
      locationId: 2,
      quantity: 2,
      serialNumbers: ['SN-101','SN-102'],
      referenceType: 'sales_order',
      referenceId: 'SO-9',
      idempotencyKey: 'tracked-issue-serials-9',
    });

    expect(result.serials.map((row) => row.serial_number)).toEqual(['SN-101','SN-102']);
    const update = client.query.mock.calls.find(([sql]) => sql.includes("SET status='issued'"));
    expect(update[1][2]).toEqual([101,102]);
  });

  test('met le lot et ses séries en rappel', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: 70, recall_number: 'RCL-70', status: 'open' }] },
      {},
      {},
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await service.openRecall({
      organisationId: 1,
      actorUserId: 8,
      recallNumber: 'RCL-70',
      itemId: 10,
      lotId: 30,
      reason: 'Défaut confirmé',
    });

    expect(result.recall.id).toBe(70);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("status='recalled'"))).toBe(true);
  });

  test('retourne les alertes d’expiration selon l’horizon demandé', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ lot_number: 'LOT-30', days_remaining: 12 }] })) };
    const rows = await service.listExpiryAlerts(db, 1, { days: 45 });
    expect(rows).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('days_remaining'), [1,45]);
  });
});
