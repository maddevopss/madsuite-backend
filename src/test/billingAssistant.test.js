const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");

const { createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function createTimeEntry({
  userId,
  projetId,
  description = "fix bug modal test ui backend frontend",
  endTime = "NOW()",
}) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (utilisateur_id, projet_id, start_time, end_time, description, hourly_rate_used)
    VALUES
      ($1, $2, NOW() - INTERVAL '1 hour', ${endTime}, $3, 100)
    RETURNING *
    `,
    [userId, projetId, description],
  );

  return result.rows[0];
}

describe("Billing Assistant", () => {
  test("POST /api/billing-assistant/suggest-description refuse sans token", async () => {
    const res = await request(app).post("/api/billing-assistant/suggest-description").send({ timeEntryId: 1 });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/billing-assistant/suggest-description refuse sans timeEntryId", async () => {
    const user = await createTestUser();
    const token = makeToken(user);

    const res = await request(app)
      .post("/api/billing-assistant/suggest-description")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message", "timeEntryId requis.");
  });

  test("POST /api/billing-assistant/suggest-description retourne 404 si entrée inexistante", async () => {
    const user = await createTestUser();
    const token = makeToken(user);

    const res = await request(app)
      .post("/api/billing-assistant/suggest-description")
      .set("Authorization", `Bearer ${token}`)
      .send({ timeEntryId: 999999 });

    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty("message", "Entrée de temps introuvable.");
  });

  test("POST /api/billing-assistant/suggest-description professionnalise la description", async () => {
    const user = await createTestUser({ role: "admin" });
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    const entry = await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      description: "fix bug modal test ui backend frontend",
    });

    const token = makeToken(user);

    const res = await request(app)
      .post("/api/billing-assistant/suggest-description")
      .set("Authorization", `Bearer ${token}`)
      .send({ timeEntryId: entry.id });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("time_entry_id", entry.id);
    expect(res.body).toHaveProperty("original_description", "fix bug modal test ui backend frontend");

    expect(res.body.suggested_description).toContain("Correction");
    expect(res.body.suggested_description).toContain("anomalie");
    expect(res.body.suggested_description).toContain("fenêtre modale");
    expect(res.body.suggested_description).toContain("validation");
    expect(res.body.suggested_description).toContain("interface utilisateur");
    expect(res.body.suggested_description).toContain("serveur applicatif");
    expect(res.body.suggested_description).toContain("interface web");
  });

  test("POST /api/billing-assistant/suggest-description retourne description par défaut si vide", async () => {
    const user = await createTestUser({ role: "admin" });
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    const entry = await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      description: "",
    });

    const token = makeToken(user);

    const res = await request(app)
      .post("/api/billing-assistant/suggest-description")
      .set("Authorization", `Bearer ${token}`)
      .send({ timeEntryId: entry.id });

    expect(res.statusCode).toBe(200);
    expect(res.body.suggested_description).toBe("Travail effectué sur le projet selon les besoins du client.");
  });

  test("POST /api/billing-assistant/suggest-description cache les entrées des autres utilisateurs pour employé", async () => {
    const admin = await createTestUser({ role: "admin" });
    const employe = await createTestUser({ role: "employe" });

    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    const entry = await createTimeEntry({
      userId: admin.id,
      projetId: projet.id,
      description: "fix bug",
    });

    const token = makeToken(employe);

    const res = await request(app)
      .post("/api/billing-assistant/suggest-description")
      .set("Authorization", `Bearer ${token}`)
      .send({ timeEntryId: entry.id });

    expect(res.statusCode).toBe(403);
  });

  test("GET /api/billing-assistant/issues refuse sans token", async () => {
    const res = await request(app).get("/api/billing-assistant/issues");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/billing-assistant/issues retourne une liste", async () => {
    const user = await createTestUser({ role: "admin" });
    const token = makeToken(user);

    const res = await request(app).get("/api/billing-assistant/issues").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/billing-assistant/issues trouve les descriptions vides", async () => {
    const user = await createTestUser({ role: "admin" });
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    const entry = await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      description: "",
    });

    const token = makeToken(user);

    const res = await request(app).get("/api/billing-assistant/issues").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.some((row) => row.id === entry.id)).toBe(true);
  });

  test("GET /api/billing-assistant/issues trouve les timers sans end_time", async () => {
    const user = await createTestUser({ role: "admin" });
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    const entry = await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      description: "Timer actif",
      endTime: "NULL",
    });

    const token = makeToken(user);

    const res = await request(app).get("/api/billing-assistant/issues").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.some((row) => row.id === entry.id && row.end_time === null)).toBe(true);
  });

  test("GET /api/billing-assistant/issues refuse employe", async () => {
    const admin = await createTestUser({ role: "admin" });
    const employe = await createTestUser({ role: "employe" });

    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    await createTimeEntry({
      userId: admin.id,
      projetId: projet.id,
      description: "",
    });

    await createTimeEntry({
      userId: employe.id,
      projetId: projet.id,
      description: "",
    });

    const token = makeToken(employe);

    const res = await request(app).get("/api/billing-assistant/issues").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });
});
