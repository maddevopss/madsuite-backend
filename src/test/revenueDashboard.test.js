const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient } = require("./helpers/testData");

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organisation_id: user.organisation_id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("revenue.routes", () => {
  let organisation;
  let user;
  let client;

  beforeAll(async () => {
    organisation = await createTestOrganisation({
      nom: `Revenue Dashboard Org ${Date.now()}`,
    });

    user = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });

    client = await createTestClient({
      nom: `Revenue Dashboard Client ${Date.now()}`,
      hourly_rate_defaut: 110,
      organisation_id: organisation.id,
    });

    await db.query(
      `
      INSERT INTO invoices
        (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, billed_by, created_at, updated_at)
      VALUES
        ($1, $2, 'REV-001', 'paid', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days', 200, 0, 200, $3, NOW(), NOW()),
        ($1, $2, 'REV-002', 'sent', CURRENT_DATE, CURRENT_DATE - INTERVAL '10 days', 500, 0, 500, $3, NOW(), NOW()),
        ($1, $2, 'REV-003', 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days', 300, 0, 300, $3, NOW(), NOW())
      `,
      [organisation.id, client.id, user.id],
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM invoices WHERE organisation_id = $1`, [organisation.id]);
    await db.query(`DELETE FROM clients WHERE organisation_id = $1`, [organisation.id]);
    await db.query(`DELETE FROM user_sessions WHERE utilisateur_id = $1`, [user.id]);
    await db.pool.query(`DELETE FROM refresh_tokens WHERE utilisateur_id = $1`, [user.id]).catch(() => null);
    await db.query(`DELETE FROM utilisateurs WHERE organisation_id = $1`, [organisation.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/revenue retourne les indicateurs de revenus", async () => {
    const token = makeToken(user);
    const res = await request(app).get("/api/revenue").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.revenueDuMois).toBeGreaterThanOrEqual(200);
    expect(res.body.paiementsRecus).toBeGreaterThanOrEqual(1);
    expect(res.body.facturesEnRetard).toBeGreaterThanOrEqual(500);
    expect(res.body.facturesDues).toBeGreaterThanOrEqual(300);
    expect(res.body.mrrEstime).toBeDefined();
    expect(res.body.recurringCount).toBeDefined();
  });
});
