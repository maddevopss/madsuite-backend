const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

describe("Auth organisation_id", () => {
  test("POST /api/login retourne un access token contenant organisation_id", async () => {
    const organisation = await createTestOrganisation({
      nom: `Auth Org ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const res = await request(app).post("/api/login").send({
      email: user.email,
      password: "Password123!",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("token");

    const decoded = jwt.decode(res.body.token);

    expect(decoded).toHaveProperty("organisation_id", organisation.id);
    expect(decoded).toHaveProperty("token_type", "access");
    expect(res.body.user).toHaveProperty("organisation_id", organisation.id);

    const sessionId = decoded.session_id;

    await db.query(`DELETE FROM refresh_tokens WHERE session_id = $1`, [sessionId]);
    await db.query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/refresh retourne un nouveau access token avec organisation_id", async () => {
    const organisation = await createTestOrganisation({
      nom: `Refresh Org ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const loginRes = await request(app).post("/api/login").send({
      email: user.email,
      password: "Password123!",
    });

    expect(loginRes.statusCode).toBe(200);

    const refreshCookie = loginRes.headers["set-cookie"]?.find((cookie) => cookie.startsWith("refresh_token="));

    expect(refreshCookie).toBeDefined();

    const refreshToken = refreshCookie.match(/refresh_token=([^;]+)/)?.[1];

    const refreshRes = await request(app).post("/api/refresh").send({
      refreshToken,
    });

    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.body).toHaveProperty("token");

    const decoded = jwt.decode(refreshRes.body.token);

    expect(decoded).toHaveProperty("organisation_id", organisation.id);
    expect(decoded).toHaveProperty("token_type", "access");

    const sessionId = jwt.decode(loginRes.body.token).session_id;

    await db.query(`DELETE FROM refresh_tokens WHERE session_id = $1`, [sessionId]);
    await db.query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });
});
