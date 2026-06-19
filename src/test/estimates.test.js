const request = require("supertest");
const jwt = require("jsonwebtoken");
const db = require("../../db");

const app = require("../app");
const { createTestOrganisation, createTestUser, createTestClient } = require("./helpers/testData");

function makeToken(role = "admin", overrides = {}) {
  return jwt.sign(
    {
      id: 999,
      email: "test@example.com",
      role,
      ...overrides,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("Estimates", () => {
  let org;
  let user;
  let clientA;
  let adminToken;

  beforeAll(async () => {
    org = await createTestOrganisation({ nom: `Org Estimates Test ${Date.now()}` });
    user = await createTestUser({ role: "admin", organisation_id: org.id });
    clientA = await createTestClient({ nom: `Client Estimates ${Date.now()}`, organisation_id: org.id });
    adminToken = makeToken("admin", { id: user.id, organisation_id: org.id });
  });

  afterAll(async () => {
    await db.query(`DELETE FROM invoices WHERE client_id = $1`, [clientA.id]);
    await db.query(`DELETE FROM estimates WHERE client_id = $1`, [clientA.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientA.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/estimates refuse sans token", async () => {
    const res = await request(app).get("/api/estimates");
    expect(res.statusCode).toBe(401);
  });

  test("POST /api/estimates crée une soumission valide", async () => {
    const res = await request(app)
      .post("/api/estimates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        client_id: clientA.id,
        items: [
          { description: "Item 1", quantity: 2, unit_rate: 100 },
          { description: "Item 2", quantity: 1, unit_rate: 50 },
        ],
        tax_rate: 15,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.estimate_number).toMatch(/^EST-\d{4}-\d{4}$/);
    expect(Number(res.body.subtotal)).toBe(250); // 2*100 + 1*50
    expect(Number(res.body.tax_total)).toBe(37.5); // 15% de 250
    expect(Number(res.body.total)).toBe(287.5);
    expect(res.body.items).toHaveLength(2);
  });

  test("GET /api/estimates liste les soumissions", async () => {
    const res = await request(app)
      .get("/api/estimates")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty("estimate_number");
  });

  test("PATCH /api/estimates/:id met à jour le statut", async () => {
    // 1. Create an estimate first
    const createRes = await request(app)
      .post("/api/estimates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        client_id: clientA.id,
        items: [{ description: "Item 1", quantity: 1, unit_rate: 100 }],
      });

    const estimateId = createRes.body.id;

    // 2. Update it
    const patchRes = await request(app)
      .patch(`/api/estimates/${estimateId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "accepted",
      });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.body.status).toBe("accepted");
  });

  test("DELETE /api/estimates/:id supprime logiquement la soumission", async () => {
    // 1. Create an estimate
    const createRes = await request(app)
      .post("/api/estimates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        client_id: clientA.id,
        items: [{ description: "Item 1", quantity: 1, unit_rate: 100 }],
      });

    const estimateId = createRes.body.id;

    // 2. Delete it
    const deleteRes = await request(app)
      .delete(`/api/estimates/${estimateId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(deleteRes.statusCode).toBe(200);

    // 3. Try to get it (should be 404 or filtered out)
    const getRes = await request(app)
      .get(`/api/estimates/${estimateId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(getRes.statusCode).toBe(404);
  });

  test("POST /api/estimates/:id/convert convertit une soumission en facture", async () => {
    // 1. Create an estimate
    const createRes = await request(app)
      .post("/api/estimates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        client_id: clientA.id,
        items: [{ description: "Item convert", quantity: 1, unit_rate: 150 }],
      });
    const estimateId = createRes.body.id;

    // 2. Try to convert (should fail because not accepted)
    const convertFailRes = await request(app)
      .post(`/api/estimates/${estimateId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(convertFailRes.statusCode).toBe(400);

    // 3. Accept it
    await request(app)
      .patch(`/api/estimates/${estimateId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "accepted" });

    // 4. Convert it
    const convertRes = await request(app)
      .post(`/api/estimates/${estimateId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(convertRes.statusCode).toBe(201);
    expect(convertRes.body.estimate_id).toBe(estimateId);
    expect(convertRes.body.status).toBe("draft");

    // 5. Check estimate is invoiced
    const getRes = await request(app)
      .get(`/api/estimates/${estimateId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(getRes.body.status).toBe("invoiced");
  });
});
