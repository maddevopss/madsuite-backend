const request = require("supertest");
const jwt = require("jsonwebtoken");
const db = require("../../db");

const app = require("../app");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

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

describe("Clients", () => {
  test("GET /api/clients refuse sans token", async () => {
    const res = await request(app).get("/api/clients");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/clients accepte avec token", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/clients").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/clients masque les clients des autres organisations", async () => {
    const orgA = await createTestOrganisation({ nom: `Org A Clients ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Org B Clients ${Date.now()}` });
    const clientA = await createTestClient({ nom: `Client Visible ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Client Masque ${Date.now()}`, organisation_id: orgB.id });
    const token = makeToken("admin", { organisation_id: orgA.id });

    const res = await request(app).get("/api/clients").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.some((row) => row.id === clientA.id)).toBe(true);
    expect(res.body.some((row) => row.id === clientB.id)).toBe(false);

    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("GET /api/clients/:id refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/clients/abc").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/clients/:id retourne 404 si client inexistant", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/clients/999999").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(404);
  });

  test("POST /api/clients refuse sans token", async () => {
    const res = await request(app).post("/api/clients").send({
      nom: "Client test",
      hourly_rate_defaut: 100,
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/clients refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`).send({
      nom: "Client test",
      hourly_rate_defaut: 100,
    });

    expect([401, 403]).toContain(res.statusCode);
  });

  test("POST /api/clients refuse client invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`).send({
      nom: "",
      hourly_rate_defaut: -10,
    });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/clients/:id refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).put("/api/clients/abc").set("Authorization", `Bearer ${token}`).send({
      nom: "Client modifié",
    });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/clients/:id refuse body invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).put("/api/clients/999999").set("Authorization", `Bearer ${token}`).send({
      nom: "",
      hourly_rate_defaut: -10,
    });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/clients/:id retourne 404 si client inexistant", async () => {
    const token = makeToken("admin");

    const res = await request(app).put("/api/clients/999999").set("Authorization", `Bearer ${token}`).send({
      nom: "Client inexistant",
    });

    expect(res.statusCode).toBe(404);
  });

  test("DELETE /api/clients/:id refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).delete("/api/clients/abc").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("DELETE /api/clients/:id refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).delete("/api/clients/1").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);
  });

  test("DELETE /api/clients/:id retourne 404 si client inexistant", async () => {
    const token = makeToken("admin");

    const res = await request(app).delete("/api/clients/999999").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(404);
  });

  test("DELETE /api/clients/:id refuse un client avec timer actif", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Client Timer ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: organisation.id });
    const client = await createTestClient({ nom: `Client Timer ${Date.now()}`, organisation_id: organisation.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Client Timer ${Date.now()}`,
      organisation_id: organisation.id,
      status: "actif",
    });
    const timer = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, organisation_id)
      VALUES ($1, $2, NOW(), NULL, 'Timer actif', 100, $3)
      RETURNING id
      `,
      [projet.id, user.id, organisation.id],
    );

    const res = await request(app)
      .delete(`/api/clients/${client.id}`)
      .set("Authorization", `Bearer ${makeToken("admin", { id: user.id, organisation_id: organisation.id })}`);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/timer roule/i);

    const unchanged = await db.query(`SELECT deleted_at FROM clients WHERE id = $1`, [client.id]);
    expect(unchanged.rows[0].deleted_at).toBeNull();

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [timer.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/clients crée un client valide", async () => {
    const token = makeToken("admin");

    const res = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        nom: `Client Création Test ${Date.now()}`,
        hourly_rate_defaut: 125,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("nom");
    expect(Number(res.body.hourly_rate_defaut)).toBe(125);
  });

  test("GET /api/clients ne retourne pas les clients soft-deleted (deleted_at IS NULL)", async () => {
    const org = await createTestOrganisation({ nom: `Org Deleted ${Date.now()}` });
    const clientActive = await createTestClient({ nom: `Client Actif ${Date.now()}`, organisation_id: org.id });
    const clientDeleted = await db.query(
      `INSERT INTO clients (nom, hourly_rate_defaut, organisation_id, deleted_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      [`Client Supprime ${Date.now()}`, 100, org.id],
    );

    const token = makeToken("admin", { organisation_id: org.id });
    const res = await request(app).get("/api/clients").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.some((row) => row.id === clientActive.id)).toBe(true);
    expect(res.body.some((row) => row.id === clientDeleted.rows[0].id)).toBe(false);

    await db.query(`DELETE FROM clients WHERE id = $1`, [clientActive.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientDeleted.rows[0].id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/clients/:id retourne 404 pour un client soft-deleted", async () => {
    const org = await createTestOrganisation({ nom: `Org Deleted Detail ${Date.now()}` });
    const deletedClient = await db.query(
      `INSERT INTO clients (nom, hourly_rate_defaut, organisation_id, deleted_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      [`Client Supprime Detail ${Date.now()}`, 100, org.id],
    );

    const token = makeToken("admin", { organisation_id: org.id });
    const res = await request(app).get(`/api/clients/${deletedClient.rows[0].id}`).set("Authorization", `Bearer ${token}`);

    expect([404, 403]).toContain(res.statusCode);

    await db.query(`DELETE FROM clients WHERE id = $1`, [deletedClient.rows[0].id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });
});
