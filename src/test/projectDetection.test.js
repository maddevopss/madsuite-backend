const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organisation_id: user.organisation_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function ensureActivityPatternsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_patterns (
      id SERIAL PRIMARY KEY,
      organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
      projet_id INTEGER NOT NULL REFERENCES projets(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      weight NUMERIC DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureActivityFeedbackTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_feedback (
      id SERIAL PRIMARY KEY,
      organisation_id INTEGER NULL,
      utilisateur_id INTEGER NULL,
      activity_log_id INTEGER NULL,
      projet_id INTEGER NULL,
      app_name TEXT,
      window_title TEXT,
      feedback_type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function createFixture(role = "admin") {
  const organisation = await createTestOrganisation({ nom: `Org PD ${Date.now()}` });
  const user = await createTestUser({ role, organisation_id: organisation.id });
  const client = await createTestClient({ organisation_id: organisation.id });
  const projet = await createTestProjet(client.id, {
    organisation_id: organisation.id,
    nom: `Projet Detection ${Date.now()}`,
  });

  return {
    organisation,
    user,
    client,
    projet,
    token: makeToken(user),
  };
}

describe("Project Detection", () => {
  beforeAll(async () => {
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await ensureActivityPatternsTable();
    await ensureActivityFeedbackTable();
  });

  test("POST /api/project-detection/suggest refuse sans token", async () => {
    const res = await request(app).post("/api/project-detection/suggest").send({
      appName: "Code",
      windowTitle: "MADSuite Backend",
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/project-detection/suggest retourne null si aucun projet ne match", async () => {
    const fixture = await createFixture("admin");

    const res = await request(app)
      .post("/api/project-detection/suggest")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        appName: "Chrome",
        windowTitle: "Google Search",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("suggestion", null);
    expect(res.body).toHaveProperty("suggestions");
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });

  test("POST /api/project-detection/suggest inclut un projet qui matche par son nom", async () => {
    const fixture = await createFixture("admin");
    const uniqueName = `MADSuite Backend ${Date.now()}`;

    await db.query("UPDATE projets SET nom = $1 WHERE id = $2", [uniqueName, fixture.projet.id]);

    const res = await request(app)
      .post("/api/project-detection/suggest")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        appName: "Code",
        windowTitle: `${uniqueName} - projectDetection.routes.js`,
      });

    expect(res.statusCode).toBe(200);

    const matched = res.body.suggestions.find((item) => item.id === fixture.projet.id);

    expect(matched).toBeTruthy();
    expect(matched.nom).toBe(uniqueName);
    expect(matched.confidence).toBeGreaterThanOrEqual(60);
  });

  test("POST /api/project-detection/suggest n'inclut pas les projets supprimés", async () => {
    const fixture = await createFixture("admin");
    const deletedProjectName = `Projet Supprimé ${Date.now()}`;

    await db.query("UPDATE projets SET nom = $1, deleted_at = NOW() WHERE id = $2", [deletedProjectName, fixture.projet.id]);

    const res = await request(app)
      .post("/api/project-detection/suggest")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        appName: "Code",
        windowTitle: `${deletedProjectName} - should not appear`,
      });

    expect(res.statusCode).toBe(200);

    const matched = res.body.suggestions.find((item) => item.id === fixture.projet.id);

    expect(matched).toBeUndefined();
  });

  test("POST /api/project-detection/suggest utilise les patterns si disponibles", async () => {
    const fixture = await createFixture("admin");
    const uniqueKeyword = `facturation-alpha-${Date.now()}`;

    await db.query(
      `
      INSERT INTO activity_patterns (organisation_id, projet_id, keyword, weight)
      VALUES ($1, $2, $3, $4)
      `,
      [fixture.organisation.id, fixture.projet.id, uniqueKeyword, 2],
    );

    const res = await request(app)
      .post("/api/project-detection/suggest")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        appName: "Chrome",
        windowTitle: `${uniqueKeyword} - tableau de bord`,
      });

    expect(res.statusCode).toBe(200);

    const matched = res.body.suggestions.find((item) => item.id === fixture.projet.id);

    expect(matched).toBeTruthy();
    expect(matched.confidence).toBeGreaterThanOrEqual(40);
  });

  test("POST /api/project-detection/suggest masque les projets d'une autre organisation", async () => {
    const fixtureA = await createFixture("admin");
    const fixtureB = await createFixture("admin");

    await db.query("UPDATE projets SET nom = $1 WHERE id = $2", ["Projet Ultra Secret Cross Org", fixtureB.projet.id]);

    const res = await request(app)
      .post("/api/project-detection/suggest")
      .set("Authorization", `Bearer ${fixtureA.token}`)
      .send({
        appName: "Code",
        windowTitle: "Projet Ultra Secret Cross Org",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.suggestions.some((item) => item.id === fixtureB.projet.id)).toBe(false);
  });

  test("POST /api/project-detection/patterns crée un pattern valide", async () => {
    const fixture = await createFixture("admin");
    const uniqueKeyword = `client-pattern-${Date.now()}`;

    const res = await request(app)
      .post("/api/project-detection/patterns")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        projet_id: fixture.projet.id,
        keyword: `   ${uniqueKeyword}   `,
        weight: 3,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.projet_id).toBe(fixture.projet.id);
    expect(res.body.keyword).toBe(uniqueKeyword);
    expect(Number(res.body.weight)).toBe(3);
    expect(Number(res.body.organisation_id)).toBe(fixture.organisation.id);
  });

  test("POST /api/project-detection/patterns refuse body incomplet", async () => {
    const fixture = await createFixture("admin");

    const res = await request(app)
      .post("/api/project-detection/patterns")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ projet_id: fixture.projet.id });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message", "Données invalides");
  });

  test("POST /api/project-detection/feedback crée un feedback", async () => {
    const fixture = await createFixture("admin");

    const res = await request(app)
      .post("/api/project-detection/feedback")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        projet_id: fixture.projet.id,
        appName: "Code",
        windowTitle: "MADSuite backend",
        feedback_type: "confirmed",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(Number(res.body.organisation_id)).toBe(fixture.organisation.id);
    expect(res.body.utilisateur_id).toBe(fixture.user.id);
  });
});
