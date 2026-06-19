// backend/src/test/billingAssistant.additional.test.js
// Additional test cases to increase coverage for billingAssistant routes
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require('./helpers/testData');

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organisation_id: user.organisation_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('Billing Assistant Additional', () => {
  test('POST /api/billing-assistant/apply rejects missing fields', async () => {
    const org = await createTestOrganisation({ nom: `Org Billing ${Date.now()}` });
    const admin = await createTestUser({ role: 'admin', organisation_id: org.id });
    const token = makeToken(admin);
    const res = await request(app)
      .post('/api/billing-assistant/apply')
      .set('Authorization', `Bearer ${token}`)
      .send({}); // empty payload
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  test('POST /api/billing-assistant/apply unauthorized without token', async () => {
    const res = await request(app).post('/api/billing-assistant/apply').send({});
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/billing-assistant/suggestions returns data for valid date', async () => {
    const org = await createTestOrganisation({ nom: `Org Billing 2 ${Date.now()}` });
    const admin = await createTestUser({ role: 'admin', organisation_id: org.id });
    const client = await createTestClient({ organisation_id: org.id });
    const projet = await createTestProjet(client.id, { organisation_id: org.id });
    const token = makeToken(admin);
    // Ensure there is at least one suggestion by creating a time entry
    await request(app)
      .post('/api/timesheet/entries')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projet_id: projet.id,
        description: 'work',
        start_time: '2023-01-01T09:00:00Z',
        end_time: '2023-01-01T10:00:00Z',
      });
    // Now fetch suggestions for today
    const today = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .get('/api/billing-assistant/suggestions')
      .set('Authorization', `Bearer ${token}`)
      .query({ date: today });
    expect(res.statusCode).toBe(200);
  });
});
