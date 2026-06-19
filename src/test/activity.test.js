const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

function makeToken(role = "admin", userId = 999, email = "test@example.com") {
  return jwt.sign({ id: userId, email, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

describe("Activity", () => {
  test("POST /api/activity refuse sans token", async () => {
    const res = await request(app).post("/api/activity").send({
      app_name: "Code",
      window_title: "test.js",
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/activity refuse token invalide", async () => {
    const res = await request(app).post("/api/activity").set("Authorization", "Bearer token-invalide-abc123").send({
      app_name: "Code",
      window_title: "test.js",
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/activity accepte token valide", async () => {
    const user = await createTestUser({ role: "admin", password: "Password123!" });
    const token = makeToken("admin", user.id, user.email);

    const res = await request(app).post("/api/activity").set("Authorization", `Bearer ${token}`).send({
      app_name: "Code",
      window_title: "test.js",
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");
  });

  test("POST /api/activity refuse activité invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).post("/api/activity").set("Authorization", `Bearer ${token}`).send({
      app_name: "",
      window_title: "",
      duration_seconds: -10,
    });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/activity/windows refuse sans token", async () => {
    const res = await request(app).post("/api/activity/windows").send({
      windows: [],
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/activity/windows refuse body invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).post("/api/activity/windows").set("Authorization", `Bearer ${token}`).send({
      windows: "pas-un-array",
      duration_seconds: -5,
    });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/activity/windows accepte windows vide", async () => {
    const token = makeToken("admin");

    const res = await request(app).post("/api/activity/windows").set("Authorization", `Bearer ${token}`).send({
      windows: [],
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success", true);
  });

  test("GET /api/activity/recent refuse sans token", async () => {
    const res = await request(app).get("/api/activity/recent");
    expect(res.statusCode).toBe(401);
  });

  test("GET /api/activity/recent accepte avec token", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/activity/recent").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/activity/latest refuse sans token", async () => {
    const res = await request(app).get("/api/activity/latest");
    expect(res.statusCode).toBe(401);
  });

  test("GET /api/activity/latest accepte avec token", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/activity/latest").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body === null || typeof res.body === "object").toBe(true);
  });

  test("GET /api/activity/summary refuse sans token", async () => {
    const res = await request(app).get("/api/activity/summary");
    expect(res.statusCode).toBe(401);
  });

  test("GET /api/activity/summary refuse sans dates", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/activity/summary").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/activity/summary accepte période complète", async () => {
    const token = makeToken("admin");

    const res = await request(app)
      .get("/api/activity/summary?date_debut=2026-05-01&date_fin=2026-05-22")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("PATCH /api/activity/:id/duration refuse id invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).patch("/api/activity/abc/duration").set("Authorization", `Bearer ${token}`).send({
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(400);
  });

  test("PATCH /api/activity/:id/duration refuse body invalide", async () => {
    const token = makeToken("admin");

    const res = await request(app).patch("/api/activity/1/duration").set("Authorization", `Bearer ${token}`).send({
      duration_seconds: -50,
    });

    expect(res.statusCode).toBe(400);
  });

  test("PATCH /api/activity/:id/duration retourne 404 si inexistant", async () => {
    const token = makeToken("admin");

    const res = await request(app).patch("/api/activity/999999/duration").set("Authorization", `Bearer ${token}`).send({
      duration_seconds: 30,
    });

    expect(res.statusCode).toBe(404);
  });

  test("DELETE /api/activity/history supprime seulement l'historique de l'utilisateur et de son organisation", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Activity Delete ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: organisation.id });
    const otherUser = await createTestUser({ role: "employe", organisation_id: organisation.id });

    await db.query(
      `
      INSERT INTO activity_logs
        (utilisateur_id, app_name, window_title, duration_seconds, type, organisation_id)
      VALUES
        ($1, 'Code', 'À supprimer', 30, 'active', $3),
        ($2, 'Code', 'À conserver', 30, 'active', $3)
      `,
      [user.id, otherUser.id, organisation.id],
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organisation_id: organisation.id, token_type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    const res = await request(app).delete("/api/activity/history").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, deleted: 1 });

    const remaining = await db.query(`SELECT utilisateur_id FROM activity_logs WHERE utilisateur_id = ANY($1::int[])`, [
      [user.id, otherUser.id],
    ]);
    expect(remaining.rows.map((row) => row.utilisateur_id)).toEqual([otherUser.id]);

    await db.query(`DELETE FROM activity_logs WHERE utilisateur_id = $1`, [otherUser.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[user.id, otherUser.id]]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });
});
