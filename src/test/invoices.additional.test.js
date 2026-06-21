// backend/src/test/invoices.additional.test.js
// Additional test cases to boost coverage for invoicing routes
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const db = require('../../db');
const { createTestOrganisation, createTestUser, createTestClient } = require('./helpers/testData');

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, organisation_id: user.organisation_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('Invoices Additional', () => {
  test('POST /api/invoices without required fields returns 400', async () => {
    const org = await createTestOrganisation({ nom: `Org Test ${Date.now()}` });
    const admin = await createTestUser({ role: 'admin', organisation_id: org.id });
    const token = makeToken(admin);
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  test('GET /api/invoices unauthorized without token returns 401', async () => {
    const res = await request(app).get('/api/invoices');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/invoices filters by organisation correctly', async () => {
    // Setup two organisations with separate invoices
    const orgA = await createTestOrganisation({ nom: `OrgA ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `OrgB ${Date.now()}` });
    const adminA = await createTestUser({ role: 'admin', organisation_id: orgA.id });
    const clientA = await createTestClient({ organisation_id: orgA.id });
    const clientB = await createTestClient({ organisation_id: orgB.id });
    // create invoices for each org
    await db.query(
      `INSERT INTO invoices (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes)
       VALUES ($1, $2, $3, 'draft', NOW(), NOW() + INTERVAL '30 days', 100, 0, 100, '')`,
      [orgA.id, clientA.id, `INV-A-${Date.now()}`],
    );
    await db.query(
      `INSERT INTO invoices (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes)
       VALUES ($1, $2, $3, 'draft', NOW(), NOW() + INTERVAL '30 days', 200, 0, 200, '')`,
      [orgB.id, clientB.id, `INV-B-${Date.now()}`],
    );
    const tokenA = makeToken(adminA);
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.statusCode).toBe(200);
    // Should only contain orgA invoice
    expect(res.body.some(i => i.invoice_number.startsWith('INV-A-'))).toBe(true);
    expect(res.body.some(i => i.invoice_number.startsWith('INV-B-'))).toBe(false);
  });
});
