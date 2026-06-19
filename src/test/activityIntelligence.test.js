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

async function createActivityLog({
  userId,
  appName = "Code",
  windowTitle = "MADSuite - activityIntelligence.routes.js",
  durationSeconds = 120,
  confidenceScore = 80,
  activityCategory = null,
}) {
  const result = await db.query(
    `
    INSERT INTO activity_logs
      (
        organisation_id,
        utilisateur_id,
        app_name,
        window_title,
        duration_seconds,
        confidence_score,
        activity_category
      )
    VALUES
      ((SELECT organisation_id FROM utilisateurs WHERE id = $1), $1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [userId, appName, windowTitle, durationSeconds, confidenceScore, activityCategory],
  );

  return result.rows[0];
}

async function ensureRuleTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_app_rules (
      id SERIAL PRIMARY KEY,
      organisation_id INTEGER NULL,
      app_pattern TEXT NOT NULL,
      title_pattern TEXT NULL,
      category TEXT NOT NULL,
      tag TEXT NULL,
      confidence INTEGER DEFAULT 80,
      is_productive BOOLEAN DEFAULT TRUE,
      priority INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_by INTEGER NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

describe("Activity Intelligence", () => {
  describe("GET /api/activity-intelligence/insights", () => {
    test("refuse sans token", async () => {
      const res = await request(app).get("/api/activity-intelligence/insights");
      expect(res.statusCode).toBe(401);
    });

    test("retourne les insights groupés pour admin", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI ${Date.now()}` });
      const admin = await createTestUser({ role: "admin", organisation_id: organisation.id });
      const employe = await createTestUser({ role: "employe", organisation_id: organisation.id });

      await createActivityLog({
        userId: admin.id,
        appName: "Code",
        windowTitle: "MADSuite backend",
        durationSeconds: 120,
        confidenceScore: 80,
        activityCategory: "Développement",
      });

      await createActivityLog({
        userId: employe.id,
        appName: "Chrome",
        windowTitle: "Documentation",
        durationSeconds: 60,
        confidenceScore: 70,
        activityCategory: "Recherche / Web",
      });

      const res = await request(app)
        .get("/api/activity-intelligence/insights")
        .set("Authorization", `Bearer ${makeToken(admin)}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test("filtre les insights pour employé", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Filter ${Date.now()}` });
      const admin = await createTestUser({ role: "admin", organisation_id: organisation.id });
      const employe = await createTestUser({ role: "employe", organisation_id: organisation.id });

      await createActivityLog({
        userId: admin.id,
        appName: "Code",
        windowTitle: "Activité admin",
        durationSeconds: 300,
        activityCategory: "Développement",
      });

      await createActivityLog({
        userId: employe.id,
        appName: "Excel",
        windowTitle: "Activité employé",
        durationSeconds: 200,
        activityCategory: "Comptabilité / Tableur",
      });

      const res = await request(app)
        .get("/api/activity-intelligence/insights")
        .set("Authorization", `Bearer ${makeToken(employe)}`);

      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/activity-intelligence/analyze", () => {
    test("refuse sans activityLogId", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Analyze ${Date.now()}` });
      const user = await createTestUser({ organisation_id: organisation.id });

      const res = await request(app)
        .post("/api/activity-intelligence/analyze")
        .set("Authorization", `Bearer ${makeToken(user)}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty("message", "activityLogId requis.");
    });

    test("analyse Code comme Développement", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Code ${Date.now()}` });
      const user = await createTestUser({ organisation_id: organisation.id });

      const log = await createActivityLog({
        userId: user.id,
        appName: "Visual Studio Code",
        windowTitle: "MADSuite backend",
      });

      const res = await request(app)
        .post("/api/activity-intelligence/analyze")
        .set("Authorization", `Bearer ${makeToken(user)}`)
        .send({ activityLogId: log.id });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        activityLogId: log.id,
        category: "Développement",
      });

      const updated = await db.query("SELECT activity_category FROM activity_logs WHERE id = $1", [log.id]);
      expect(updated.rows[0].activity_category).toBe("Développement");
    });

    test("employé ne peut pas analyser une activité d'un autre utilisateur", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Cross ${Date.now()}` });
      const userA = await createTestUser({ role: "employe", organisation_id: organisation.id });
      const userB = await createTestUser({ role: "employe", organisation_id: organisation.id });

      const log = await createActivityLog({
        userId: userB.id,
        appName: "Code",
        windowTitle: "Activité autre utilisateur",
      });

      const res = await request(app)
        .post("/api/activity-intelligence/analyze")
        .set("Authorization", `Bearer ${makeToken(userA)}`)
        .send({ activityLogId: log.id });

      expect(res.statusCode).toBe(403);
    });

    test("admin ne peut pas modifier un activityLogId d'une autre organisation", async () => {
      const orgA = await createTestOrganisation({ nom: `Org AI Admin A ${Date.now()}` });
      const orgB = await createTestOrganisation({ nom: `Org AI Admin B ${Date.now()}` });

      const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
      const userB = await createTestUser({ role: "employe", organisation_id: orgB.id });

      const logB = await createActivityLog({
        userId: userB.id,
        appName: "Visual Studio Code",
        windowTitle: "MADSuite backend",
        activityCategory: null,
        confidenceScore: 10,
      });

      const before = await db.query("SELECT activity_category, confidence_score FROM activity_logs WHERE id = $1", [
        logB.id,
      ]);

      expect(before.rows[0].activity_category).toBeNull();

      const res = await request(app)
        .post("/api/activity-intelligence/analyze")
        .set("Authorization", `Bearer ${makeToken(adminA)}`)
        .send({ activityLogId: logB.id });

      // Après correctif : le log est introuvable côté orgA
      expect(res.statusCode).toBe(404);

      const after = await db.query("SELECT activity_category, confidence_score FROM activity_logs WHERE id = $1", [logB.id]);

      expect(after.rows[0].activity_category).toBeNull();
      expect(Number(after.rows[0].confidence_score)).toBe(10);
    });
  });

  describe("POST /api/activity-intelligence/classify", () => {
    test("classifie une activité Code", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Classify ${Date.now()}` });
      const user = await createTestUser({ organisation_id: organisation.id });

      const res = await request(app)
        .post("/api/activity-intelligence/classify")
        .set("Authorization", `Bearer ${makeToken(user)}`)
        .send({
          currentActivity: {
            app_name: "Visual Studio Code",
            window_title: "MADSuite backend",
          },
          openWindows: [],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("category");
      expect(res.body).toHaveProperty("confidence");
    });

    test("refuse body invalide", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Invalid ${Date.now()}` });
      const user = await createTestUser({ organisation_id: organisation.id });

      const res = await request(app)
        .post("/api/activity-intelligence/classify")
        .set("Authorization", `Bearer ${makeToken(user)}`)
        .send({ openWindows: "pas-un-tableau" });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("activity rules", () => {
    test("admin peut créer, modifier et désactiver une règle dans son organisation", async () => {
      await ensureRuleTable();

      const organisation = await createTestOrganisation({ nom: `Org AI Rules ${Date.now()}` });
      const admin = await createTestUser({ role: "admin", organisation_id: organisation.id });
      const token = makeToken(admin);

      const create = await request(app)
        .post("/api/activity-intelligence/rules")
        .set("Authorization", `Bearer ${token}`)
        .send({
          app_pattern: "Code",
          title_pattern: "MADSuite",
          category: "Développement",
          tag: "dev",
          confidence: 90,
          is_productive: true,
          priority: 5,
          active: true,
        });

      expect(create.statusCode).toBe(201);
      expect(create.body).toHaveProperty("id");
      expect(Number(create.body.organisation_id)).toBe(organisation.id);

      const update = await request(app)
        .put(`/api/activity-intelligence/rules/${create.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ priority: 9, active: false });

      expect(update.statusCode).toBe(200);
      expect(Number(update.body.priority)).toBe(9);
      expect(update.body.active).toBe(false);

      const del = await request(app)
        .delete(`/api/activity-intelligence/rules/${create.body.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(del.statusCode).toBe(200);
      expect(del.apiResponse).toMatchObject({ success: true, code: "RULE_DISABLED" });
    });

    test("admin ne peut pas modifier une règle d'une autre organisation", async () => {
      await ensureRuleTable();

      const orgA = await createTestOrganisation({ nom: `Org Rule A ${Date.now()}` });
      const orgB = await createTestOrganisation({ nom: `Org Rule B ${Date.now()}` });
      const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
      const adminB = await createTestUser({ role: "admin", organisation_id: orgB.id });

      const create = await request(app)
        .post("/api/activity-intelligence/rules")
        .set("Authorization", `Bearer ${makeToken(adminA)}`)
        .send({
          app_pattern: "Chrome",
          category: "Recherche / Web",
          confidence: 80,
          is_productive: true,
          priority: 1,
          active: true,
        });

      expect(create.statusCode).toBe(201);

      const update = await request(app)
        .put(`/api/activity-intelligence/rules/${create.body.id}`)
        .set("Authorization", `Bearer ${makeToken(adminB)}`)
        .send({ priority: 10 });

      expect(update.statusCode).toBe(404);
    });
  });

  describe("POST /api/activity-intelligence/feedback", () => {
    test("accepte un feedback confirmed et apprend un pattern", async () => {
      const organisation = await createTestOrganisation({ nom: `Org AI Feedback ${Date.now()}` });
      const user = await createTestUser({ organisation_id: organisation.id });
      const client = await createTestClient({ organisation_id: organisation.id });
      const projet = await createTestProjet(client.id, { organisation_id: organisation.id });

      const res = await request(app)
        .post("/api/activity-intelligence/feedback")
        .set("Authorization", `Bearer ${makeToken(user)}`)
        .send({
          app_name: "Code",
          window_title: "MADSuite backend",
          projet_id: projet.id,
          confirmed_category: "Développement",
          confirmed_tag: "dev",
          feedback_type: "confirmed",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(Number(res.body.organisation_id)).toBe(organisation.id);
    });
  });
});
