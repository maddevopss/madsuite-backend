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
          email: "timer-test@example.com",
          role: userOrRole,
        };

  return jwt.sign({ ...base, ...overrides }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

async function createTimerFixture(role = "admin") {
  const organisation = await createTestOrganisation({ nom: `Org Timer ${Date.now()}` });
  const user = await createTestUser({ role, organisation_id: organisation.id });
  const client = await createTestClient({ organisation_id: organisation.id });
  const projet = await createTestProjet(client.id, {
    organisation_id: organisation.id,
    nom: `Projet Timer ${Date.now()}`,
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

beforeAll(async () => {
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS note TEXT`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS organisation_id INTEGER`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS distance_km DECIMAL(10, 2) DEFAULT 0`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS is_billed BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS invoice_id INTEGER`);
  await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hourly_rate_used DECIMAL(10, 2)`);
});

describe("Timer", () => {
  test("GET /api/timer/active refuse sans token", async () => {
    const res = await request(app).get("/api/timer/active");
    expect(res.statusCode).toBe(401);
  });

  test("GET /api/timer/active refuse un token sans organisation_id", async () => {
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

    const res = await request(app).get("/api/timer/active").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
    expect(res.apiResponse.code).toBe("ORGANISATION_REQUIRED");
    expect(res.body).toHaveProperty("message", "Aucune organisation associée à cet utilisateur.");
  });

  test("GET /api/timer/active retourne null si aucun timer actif", async () => {
    const { token } = await createTimerFixture("admin");

    const res = await request(app).get("/api/timer/active").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.apiResponse).toMatchObject({
      success: true,
      code: "NO_ACTIVE_TIMER",
      data: null,
    });
  });

  test("POST /api/timer/start refuse projet invalide", async () => {
    const { token } = await createTimerFixture("admin");

    const res = await request(app).post("/api/timer/start").set("Authorization", `Bearer ${token}`).send({
      projet_id: "",
      description: "Test timer",
    });

    expect(res.statusCode).toBe(400);
    expect(res.apiResponse.code).toBe("TIMER_VALIDATION_FAILED");
  });

  test("POST /api/timer/start démarre un timer sur un projet de la même organisation", async () => {
    const { token, projet, user, organisation } = await createTimerFixture("admin");

    const res = await request(app).post("/api/timer/start").set("Authorization", `Bearer ${token}`).send({
      projet_id: projet.id,
      description: "Timer valide",
    });

    expect(res.statusCode).toBe(201);
    expect(res.apiResponse).toMatchObject({
      success: true,
      code: "TIMER_STARTED",
    });
    expect(res.body).toHaveProperty("id");
    expect(res.body.projet_id).toBe(projet.id);
    expect(res.body.utilisateur_id).toBe(user.id);
    expect(Number(res.body.organisation_id)).toBe(organisation.id);
    expect(res.body.end_time).toBeNull();
  });

  test("POST /api/timer/start refuse un projet d'une autre organisation", async () => {
    const fixtureA = await createTimerFixture("admin");
    const fixtureB = await createTimerFixture("admin");

    const res = await request(app).post("/api/timer/start").set("Authorization", `Bearer ${fixtureA.token}`).send({
      projet_id: fixtureB.projet.id,
      description: "Tentative cross-org",
    });

    expect(res.statusCode).toBe(404);
    expect(res.apiResponse.code).toBe("TIMER_START_FAILED");
    expect(res.body).toHaveProperty("message", "Projet introuvable ou non accessible.");
  });

  test("PATCH /api/timer/active/note met à jour la note du timer actif", async () => {
    const { token, projet } = await createTimerFixture("admin");

    const start = await request(app).post("/api/timer/start").set("Authorization", `Bearer ${token}`).send({
      projet_id: projet.id,
      description: "Timer avec note",
    });

    expect(start.statusCode).toBe(201);

    const res = await request(app)
      .patch("/api/timer/active/note")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "note rapide" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      id: start.body.id,
      note: "note rapide",
    });
    expect(res.apiResponse.code).toBe("TIMER_NOTE_UPDATED");
  });

  test("PATCH /api/timer/active/note retourne 400 si note n'est pas une chaîne", async () => {
    const { token } = await createTimerFixture("admin");

    const res = await request(app)
      .patch("/api/timer/active/note")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: 123 });

    expect(res.statusCode).toBe(400);
    expect(res.apiResponse.code).toBe("TIMER_NOTE_UPDATE_FAILED");
  });

  test("PATCH /api/timer/stop arrête le timer actif de la même organisation", async () => {
    const { token, projet } = await createTimerFixture("admin");

    const start = await request(app).post("/api/timer/start").set("Authorization", `Bearer ${token}`).send({
      projet_id: projet.id,
      description: "Timer à stopper",
    });

    expect(start.statusCode).toBe(201);

    const res = await request(app).patch("/api/timer/stop").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("id", start.body.id);
    expect(res.body.end_time).not.toBeNull();
    expect(res.apiResponse.code).toBe("TIMER_STOPPED");
  });

  test("GET /api/timer/today-projects retourne les projets utilisés aujourd'hui", async () => {
    const { token, projet } = await createTimerFixture("admin");

    const start = await request(app).post("/api/timer/start").set("Authorization", `Bearer ${token}`).send({
      projet_id: projet.id,
      description: "Projet du jour",
    });
    expect(start.statusCode).toBe(201);

    await request(app).patch("/api/timer/stop").set("Authorization", `Bearer ${token}`);

    const res = await request(app).get("/api/timer/today-projects").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.apiResponse.code).toBe("TIMER_TODAY_PROJECTS");
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((row) => row.projet_id === projet.id)).toBe(true);
  });
});
