jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = { id: 1, organisation_id: 77, role: 'admin' };
  next();
});

jest.mock('../middleware/requireModule', () => ({
  requireModule: () => (_req, _res, next) => next(),
}));

const mockQuery = jest.fn();
jest.mock('../middleware/organization.middleware', () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = 77;
    req.db = { query: mockQuery };
    next();
  },
}));

jest.mock('../middleware/requireRole', () => () => (_req, _res, next) => next());

const request = require('supertest');
const app = require('../app');

describe('routes des remises de paie', () => {
  beforeEach(() => mockQuery.mockReset());

  test('liste uniquement les remises de l’organisation courante', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, authority: 'RQ', status: 'draft' }] });

    const response = await request(app).get('/api/payroll/remittances');

    expect(response.status).toBe(200);
    expect(response.body.remittances).toEqual([{ id: 3, authority: 'RQ', status: 'draft' }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE organisation_id=$1'), [77]);
  });

  test('crée une remise idempotente avec les montants validés', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 4, total_amount: '150.00', status: 'draft' }] });

    const response = await request(app).post('/api/payroll/remittances').send({
      authority: 'RQ',
      remittanceType: 'source_deductions',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
      dueDate: '2026-07-20',
      employeeAmount: 100,
      employerAmount: 50,
      idempotencyKey: 'remittance-4',
    });

    expect(response.status).toBe(201);
    expect(response.body.remittance.id).toBe(4);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining([77, 'RQ', 'source_deductions', 100, 50, 'remittance-4']));
  });

  test('exige une confirmation avant de marquer une remise payée', async () => {
    const response = await request(app).post('/api/payroll/remittances/4/pay').send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/confirmation/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
