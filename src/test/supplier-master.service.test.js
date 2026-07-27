jest.mock('../../db', () => ({ pool: { connect: jest.fn() } }));

const db = require('../../db');
const service = require('../services/business/supplier-master.service');

function clientWith(responses) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  for (const response of responses) client.query.mockResolvedValueOnce(response);
  db.pool.connect.mockResolvedValueOnce(client);
  return client;
}

describe('supplier-master.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('crée un fournisseur et son événement de preuve', async () => {
    const supplier = { id: 41, supplier_number: 'SUP-0041', status: 'active' };
    const client = clientWith([
      { rows: [] },
      { rows: [] },
      { rows: [supplier] },
      { rows: [{ id: 1 }] },
      { rows: [] },
    ]);

    const result = await service.createSupplier({
      organisationId: 9,
      actorUserId: 7,
      payload: {
        supplierNumber: 'SUP-0041',
        legalName: 'Atelier Boréal inc.',
        idempotencyKey: 'supplier-0041-create',
        paymentTermsDays: 30,
      },
    });

    expect(result).toEqual({ supplier, duplicate: false });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO supplier_audit_events'))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('retourne le dossier existant lors du rejeu idempotent', async () => {
    const supplier = { id: 42, supplier_number: 'SUP-0042' };
    const client = clientWith([
      { rows: [] },
      { rows: [supplier] },
      { rows: [] },
    ]);

    const result = await service.createSupplier({
      organisationId: 9,
      actorUserId: 7,
      payload: {
        supplierNumber: 'SUP-0042',
        legalName: 'Nordique ltée',
        idempotencyKey: 'supplier-0042-create',
      },
    });

    expect(result).toEqual({ supplier, duplicate: true });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO suppliers'))).toBe(false);
  });

  test('refuse un changement de statut sans justification', async () => {
    await expect(service.changeStatus({
      organisationId: 9,
      supplierId: 42,
      status: 'blocked',
      reason: ' ',
      actorUserId: 7,
      idempotencyKey: 'supplier-0042-block',
    })).rejects.toMatchObject({ statusCode: 400, message: 'supplier.status_reason_required' });
  });

  test('conserve le statut précédent et le nouveau dans le journal', async () => {
    const updated = { id: 42, status: 'on_hold' };
    const client = clientWith([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 42, status: 'active' }] },
      { rows: [updated] },
      { rows: [{ id: 99 }] },
      { rows: [] },
    ]);

    const result = await service.changeStatus({
      organisationId: 9,
      supplierId: 42,
      status: 'on_hold',
      reason: 'Assurance échue',
      actorUserId: 7,
      idempotencyKey: 'supplier-0042-hold',
    });

    expect(result).toEqual({ supplier: updated, duplicate: false });
    const auditCall = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO supplier_audit_events'));
    expect(auditCall[1][4]).toEqual({ from: 'active', to: 'on_hold' });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});
