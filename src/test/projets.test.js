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

describe("Projets", () => {
  test("GET /api/projets refuse sans token", async () => {
    const res = await request(app).get("/api/projets");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/projets accepte avec token", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/projets").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/projets masque les projets des autres organisations", async () => {
    const orgA = await createTestOrganisation({ nom: `Org A Projets ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Org B Projets ${Date.now()}` });
    const clientA = await createTestClient({ nom: `Client Org A ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Client Org B ${Date.now()}`, organisation_id: orgB.id });
    const projetA = await createTestProjet(clientA.id, { nom: `Projet Org A ${Date.now()}`, organisation_id: orgA.id });
    const projetB = await createTestProjet(clientB.id, { nom: `Projet Org B ${Date.now()}`, organisation_id: orgB.id });
    const token = makeToken("admin", { organisation_id: orgA.id });

    const res = await request(app).get("/api/projets").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.some((row) => row.id === projetA.id)).toBe(true);
    expect(res.body.some((row) => row.id === projetB.id)).toBe(false);

    await db.query(`DELETE FROM projets WHERE id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("GET /api/projets/client/:id refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/projets/client/abc").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/projets/client/:id accepte id valide", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/projets/client/2147483647").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("POST /api/projets refuse sans token", async () => {
    const res = await request(app).post("/api/projets").send({
      client_id: 1,
      nom: "Projet test",
      taux_horaire: 100,
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/projets refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).post("/api/projets").set("Authorization", `Bearer ${token}`).send({
      client_id: 1,
      nom: "Projet test",
      taux_horaire: 100,
    });

    expect([401, 403]).toContain(res.statusCode);
  });

  test("POST /api/projets refuse projet invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).post("/api/projets").set("Authorization", `Bearer ${token}`).send({
      client_id: "",
      nom: "",
      taux_horaire: -10,
    });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/projets refuse client_id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).post("/api/projets").set("Authorization", `Bearer ${token}`).send({
      client_id: "abc",
      nom: "Projet test",
      taux_horaire: 100,
    });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/projets refuse un client d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Org A Create ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Org B Create ${Date.now()}` });
    const clientB = await createTestClient({ nom: `Client Cross Org ${Date.now()}`, organisation_id: orgB.id });
    const token = makeToken("admin", { organisation_id: orgA.id });

    const res = await request(app)
      .post("/api/projets")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client_id: clientB.id,
        nom: `Projet Cross Org ${Date.now()}`,
        taux_horaire: 100,
      });

    expect(res.statusCode).toBe(404);

    await db.query(`DELETE FROM clients WHERE id = $1`, [clientB.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("PUT /api/projets/:id refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).put("/api/projets/abc").set("Authorization", `Bearer ${token}`).send({
      nom: "Projet modifié",
    });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/projets/:id refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).put("/api/projets/1").set("Authorization", `Bearer ${token}`).send({
      nom: "Projet modifié",
    });

    expect([401, 403]).toContain(res.statusCode);
  });

  test("PUT /api/projets/:id refuse body invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).put("/api/projets/2147483647").set("Authorization", `Bearer ${token}`).send({
      nom: "",
      taux_horaire: -10,
    });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/projets/:id retourne 404 si projet inexistant", async () => {
    const token = makeToken("admin");

    const res = await request(app).put("/api/projets/2147483647").set("Authorization", `Bearer ${token}`).send({
      nom: "Projet inexistant",
    });

    expect(res.statusCode).toBe(404);
  });

  test("PUT /api/projets/:id refuse de changer vers un client d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Org Update A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Org Update B ${Date.now()}` });
    const clientA = await createTestClient({ nom: `Client Update A ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Client Update B ${Date.now()}`, organisation_id: orgB.id });
    const projetA = await createTestProjet(clientA.id, {
      nom: `Projet Update A ${Date.now()}`,
      organisation_id: orgA.id,
    });
    const token = makeToken("admin", { organisation_id: orgA.id });

    const res = await request(app)
      .put(`/api/projets/${projetA.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientB.id });

    expect(res.statusCode).toBe(404);

    const unchanged = await db.query(`SELECT client_id, organisation_id FROM projets WHERE id = $1`, [projetA.id]);
    expect(unchanged.rows[0].client_id).toBe(clientA.id);
    expect(unchanged.rows[0].organisation_id).toBe(orgA.id);
  });

  test("DELETE /api/projets/:id refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).delete("/api/projets/abc").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("DELETE /api/projets/:id refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).delete("/api/projets/1").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);
  });

  test("DELETE /api/projets/:id retourne 404 si projet inexistant", async () => {
    const token = makeToken("admin");

    const res = await request(app).delete("/api/projets/2147483647").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(404);
  });

  test("DELETE /api/projets/:id refuse un projet avec timer actif", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Projet Timer ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: organisation.id });
    const client = await createTestClient({ nom: `Client Projet Timer ${Date.now()}`, organisation_id: organisation.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Timer ${Date.now()}`,
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
      .delete(`/api/projets/${projet.id}`)
      .set("Authorization", `Bearer ${makeToken("admin", { id: user.id, organisation_id: organisation.id })}`);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/timer est actif/i);

    const unchanged = await db.query(`SELECT deleted_at, status FROM projets WHERE id = $1`, [projet.id]);
    expect(unchanged.rows[0].deleted_at).toBeNull();
    expect(unchanged.rows[0].status).toBe("actif");

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [timer.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/projets/:id refuse d'archiver un projet avec timer actif", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Archive Timer ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: organisation.id });
    const client = await createTestClient({ nom: `Client Archive Timer ${Date.now()}`, organisation_id: organisation.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Archive Timer ${Date.now()}`,
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
      .put(`/api/projets/${projet.id}`)
      .set("Authorization", `Bearer ${makeToken("admin", { id: user.id, organisation_id: organisation.id })}`)
      .send({ status: "archive" });

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/timer est actif/i);

    const unchanged = await db.query(`SELECT status FROM projets WHERE id = $1`, [projet.id]);
    expect(unchanged.rows[0].status).toBe("actif");

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [timer.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/projets crée un projet valide", async () => {
    const token = makeToken("admin");
    const client = await createTestClient();

    const res = await request(app)
      .post("/api/projets")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client_id: client.id,
        nom: `Projet Création Test ${Date.now()}`,
        taux_horaire: 150,
        status: "actif",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("client_id", client.id);
    expect(res.body).toHaveProperty("nom");
  });

  test("GET /api/projets ne retourne pas les projets soft-deleted", async () => {
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

    const org = await createTestOrganisation({ nom: `Org Projet Soft List ${Date.now()}` });
    const client = await createTestClient({ nom: `Client Projet Soft List ${Date.now()}`, organisation_id: org.id });
    const active = await createTestProjet(client.id, {
      nom: `Projet Actif Soft List ${Date.now()}`,
      organisation_id: org.id,
    });
    const deleted = await createTestProjet(client.id, {
      nom: `Projet Supprime Soft List ${Date.now()}`,
      organisation_id: org.id,
    });
    await db.query(`UPDATE projets SET deleted_at = NOW(), status = 'archive' WHERE id = $1`, [deleted.id]);

    const token = makeToken("admin", { organisation_id: org.id });
    const res = await request(app).get("/api/projets").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.some((row) => row.id === active.id)).toBe(true);
    expect(res.body.some((row) => row.id === deleted.id)).toBe(false);
  });
});
