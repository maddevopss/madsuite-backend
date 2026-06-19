const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(userOrRole = "admin", overrides = {}) {
  const base =
    typeof userOrRole === "object"
      ? {
          id: userOrRole.id,
          email: userOrRole.email,
          role: userOrRole.role,
          organisation_id: userOrRole.organisation_id,
        }
      : {
          id: 999,
          email: "timesheet-test@example.com",
          role: userOrRole,
        };

  return jwt.sign({ ...base, ...overrides }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

async function createFixture(role = "admin") {
  const organisation = await createTestOrganisation({ nom: `Org Timesheet ${Date.now()}` });
  const user = await createTestUser({ role, organisation_id: organisation.id });
  const client = await createTestClient({
    nom: `Client Timesheet ${Date.now()}`,
    organisation_id: organisation.id,
    hourly_rate_defaut: 100,
  });
  const projet = await createTestProjet(client.id, {
    nom: `Projet Timesheet ${Date.now()}`,
    organisation_id: organisation.id,
    taux_horaire: 125,
    status: "actif",
  });

  return {
    organisation,
    user,
    client,
    projet,
    token: makeToken(user),
  };
}

async function createEntry({
  projet,
  user,
  organisation,
  description = "Entrée test",
  start = "2026-05-21 09:00:00",
  end = "2026-05-21 10:00:00",
  isBilled = false,
}) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
    `,
    [projet.id, user.id, start, end, description, 125, isBilled, organisation.id],
  );

  return result.rows[0];
}

function getEntriesResponseRows(res) {
  return res.body.data;
}

describe("Timesheet", () => {
  test("GET /api/timesheet/dashboard refuse sans token", async () => {
    const res = await request(app).get("/api/timesheet/dashboard");
    expect(res.statusCode).toBe(401);
  });

  test("GET /api/timesheet/dashboard refuse un token sans organisation_id", async () => {
    const token = jwt.sign(
      {
        id: 999,
        email: "no-org@example.com",
        role: "admin",
        organisation_id: null,
        token_type: "access",
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    const res = await request(app).get("/api/timesheet/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
    expect(res.body).toHaveProperty("message", "Aucune organisation associée à cet utilisateur.");
  });

  test("GET /api/timesheet/dashboard accepte avec organisation_id", async () => {
    const { token } = await createFixture("admin");

    const res = await request(app).get("/api/timesheet/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("semaine");
    expect(res.body).toHaveProperty("mois");
    expect(res.body).toHaveProperty("pct_facturable");
    expect(res.body).toHaveProperty("montant_a_facturer");
    expect(res.body).toHaveProperty("par_client");
    expect(res.body).toHaveProperty("par_jour");
  });

  test("GET /api/timesheet/projets retourne seulement les projets de l'organisation", async () => {
    const fixtureA = await createFixture("admin");
    const fixtureB = await createFixture("admin");

    const res = await request(app).get("/api/timesheet/projets").set("Authorization", `Bearer ${fixtureA.token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((row) => row.id === fixtureA.projet.id)).toBe(true);
    expect(res.body.some((row) => row.id === fixtureB.projet.id)).toBe(false);
  });

  test("GET /api/timesheet/entries retourne un tableau et masque les autres organisations", async () => {
    const fixtureA = await createFixture("admin");
    const fixtureB = await createFixture("admin");

    const entryA = await createEntry({ ...fixtureA, description: "Org A" });
    const entryB = await createEntry({ ...fixtureB, description: "Org B" });

    const res = await request(app)
      .get("/api/timesheet/entries?date_debut=2026-05-21&date_fin=2026-05-21")
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty("pagination");
    expect(getEntriesResponseRows(res).some((row) => row.id === entryA.id)).toBe(true);
    expect(getEntriesResponseRows(res).some((row) => row.id === entryB.id)).toBe(false);
  });

  test("GET /api/timesheet/entries filtre par date, client et is_billed", async () => {
    const fixture = await createFixture("admin");

    const billed = await createEntry({
      ...fixture,
      description: "Facturée",
      start: "2026-05-20 09:00:00",
      end: "2026-05-20 10:00:00",
      isBilled: true,
    });

    const unbilled = await createEntry({
      ...fixture,
      description: "Non facturée",
      start: "2026-05-21 09:00:00",
      end: "2026-05-21 10:00:00",
      isBilled: false,
    });

    const res = await request(app)
      .get(`/api/timesheet/entries?date_debut=2026-05-20&date_fin=2026-05-21&client_id=${fixture.client.id}&is_billed=false`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(getEntriesResponseRows(res).some((row) => row.id === unbilled.id)).toBe(true);
    expect(getEntriesResponseRows(res).some((row) => row.id === billed.id)).toBe(false);
  });

  test("GET /api/timesheet/entries admin peut filtrer par utilisateur_id", async () => {
    const fixture = await createFixture("admin");
    const employe = await createTestUser({ role: "employe", organisation_id: fixture.organisation.id });

    const entryAdmin = await createEntry({ ...fixture, description: "Admin" });
    const entryEmploye = await createEntry({ ...fixture, user: employe, description: "Employe" });

    const res = await request(app)
      .get(`/api/timesheet/entries?date_debut=2026-05-21&date_fin=2026-05-21&utilisateur_id=${employe.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.statusCode).toBe(200);
    expect(getEntriesResponseRows(res).some((row) => row.id === entryEmploye.id)).toBe(true);
    expect(getEntriesResponseRows(res).some((row) => row.id === entryAdmin.id)).toBe(false);
  });

  test("GET /api/timesheet/entries applique page et limit", async () => {
    const fixture = await createFixture("admin");

    const first = await createEntry({
      ...fixture,
      description: "Premiere",
      start: "2026-05-21 09:00:00",
      end: "2026-05-21 10:00:00",
    });
    const second = await createEntry({
      ...fixture,
      description: "Deuxieme",
      start: "2026-05-21 11:00:00",
      end: "2026-05-21 12:00:00",
    });

    const res = await request(app)
      .get("/api/timesheet/entries?date_debut=2026-05-21&date_fin=2026-05-21&page=1&limit=1")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toHaveProperty("id", second.id);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
    expect(res.body.data.some((row) => row.id === first.id)).toBe(false);
  });

  test("POST /api/timesheet/manual crée une entrée valide", async () => {
    const fixture = await createFixture("employe");

    const res = await request(app).post("/api/timesheet/manual").set("Authorization", `Bearer ${fixture.token}`).send({
      projet_id: fixture.projet.id,
      start_time: "2026-05-28T09:00:00",
      end_time: "2026-05-28T10:00:00",
      description: "Entrée manuelle",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("projet_id", fixture.projet.id);
    expect(Number(res.body.organisation_id)).toBe(fixture.organisation.id);
  });

  test("POST /api/timesheet/manual refuse end_time avant start_time", async () => {
    const fixture = await createFixture("admin");

    const res = await request(app).post("/api/timesheet/manual").set("Authorization", `Bearer ${fixture.token}`).send({
      projet_id: fixture.projet.id,
      start_time: "2026-05-21T10:00:00",
      end_time: "2026-05-21T09:00:00",
      description: "Invalide",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message", "Plage horaire invalide.");
  });

  test("POST /api/timesheet/manual refuse un projet d'une autre organisation", async () => {
    const fixtureA = await createFixture("admin");
    const fixtureB = await createFixture("admin");

    const res = await request(app).post("/api/timesheet/manual").set("Authorization", `Bearer ${fixtureA.token}`).send({
      projet_id: fixtureB.projet.id,
      start_time: "2026-05-21T09:00:00",
      end_time: "2026-05-21T10:00:00",
      description: "Cross org",
    });

    expect(res.statusCode).toBe(404);
  });

  test("PATCH /api/timesheet/entries/:id modifie sa propre entrée", async () => {
    const fixture = await createFixture("employe");
    const entry = await createEntry({ ...fixture, description: "Avant" });

    const res = await request(app)
      .patch(`/api/timesheet/entries/${entry.id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ description: "Après" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("id", entry.id);
    expect(res.body).toHaveProperty("description", "Après");
  });

  test("PATCH /api/timesheet/entries/:id refuse un id invalide", async () => {
    const fixture = await createFixture("admin");

    const res = await request(app)
      .patch("/api/timesheet/entries/abc")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ description: "Invalide" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message", "ID invalide");
  });
  test("PATCH /api/timesheet/entries/:id empêche un employé de modifier l'entrée d'un autre utilisateur", async () => {
    const fixture = await createFixture("employe");
    const otherUser = await createTestUser({ role: "employe", organisation_id: fixture.organisation.id });
    const entry = await createEntry({ ...fixture, user: otherUser, description: "Autre user" });

    const res = await request(app)
      .patch(`/api/timesheet/entries/${entry.id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ description: "Hack" });

    expect(res.statusCode).toBe(404);
  });

  test("PATCH /api/timesheet/entries/:id refuse un projet soft-deleted", async () => {
    const fixture = await createFixture("admin");
    const deletedProject = await createTestProjet(fixture.client.id, {
      nom: `Projet supprime update ${Date.now()}`,
      organisation_id: fixture.organisation.id,
      status: "actif",
    });
    const entry = await createEntry({ ...fixture, description: "Projet original" });

    await db.query(`UPDATE projets SET deleted_at = NOW() WHERE id = $1`, [deletedProject.id]);

    const res = await request(app)
      .patch(`/api/timesheet/entries/${entry.id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ projet_id: deletedProject.id });

    expect(res.statusCode).toBe(404);

    const unchanged = await db.query(`SELECT projet_id FROM time_entries WHERE id = $1`, [entry.id]);
    expect(unchanged.rows[0].projet_id).toBe(fixture.projet.id);
  });

  test("PATCH /api/timesheet/entries/:id/facturer refuse body invalide", async () => {
    const fixture = await createFixture("admin");
    const entry = await createEntry({ ...fixture });

    const res = await request(app)
      .patch(`/api/timesheet/entries/${entry.id}/facturer`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ is_billed: "oui" });

    expect(res.statusCode).toBe(400);
  });

  test("PATCH /api/timesheet/entries/:id/facturer met à jour is_billed", async () => {
    const fixture = await createFixture("admin");
    const entry = await createEntry({ ...fixture, isBilled: false });

    const res = await request(app)
      .patch(`/api/timesheet/entries/${entry.id}/facturer`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ is_billed: true });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("id", entry.id);
    expect(res.body).toHaveProperty("is_billed", true);
  });

  test("DELETE /api/timesheet/entries/:id soft delete l'entrée", async () => {
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

    const fixture = await createFixture("admin");
    const entry = await createEntry({ ...fixture, description: "Soft delete" });

    const res = await request(app)
      .delete(`/api/timesheet/entries/${entry.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("deletedId", entry.id);

    const dbEntry = await db.query(`SELECT deleted_at FROM time_entries WHERE id = $1`, [entry.id]);
    expect(dbEntry.rows[0].deleted_at).toBeTruthy();

    const list = await request(app)
      .get("/api/timesheet/entries?date_debut=2026-05-21&date_fin=2026-05-21")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(list.statusCode).toBe(200);
    expect(getEntriesResponseRows(list).some((row) => row.id === entry.id)).toBe(false);
  });

  test("DELETE /api/timesheet/entries/:id refuse id inexistant", async () => {
    const fixture = await createFixture("admin");

    const res = await request(app).delete("/api/timesheet/entries/999999").set("Authorization", `Bearer ${fixture.token}`);

    expect(res.statusCode).toBe(404);
  });
});
