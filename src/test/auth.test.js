const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

async function loginUser(user) {
  return request(app).post("/api/login").send({
    email: user.email,
    password: user.password,
  });
}

describe("Auth / Login", () => {
  test("POST /api/login refuse body vide", async () => {
    const res = await request(app).post("/api/login").send({});
    expect(res.statusCode).toBe(400);
  });

  test("POST /api/login refuse utilisateur inexistant", async () => {
    const res = await request(app).post("/api/login").send({
      email: "inexistant@example.com",
      password: "Password123!",
    });

    expect(res.statusCode).toBe(401);
    expect(res.apiResponse).toHaveProperty("success", false);
  });

  test("POST /api/login accepte un utilisateur valide et inclut organisation_id dans le token", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Auth ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const res = await loginUser(user);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("token");
    expect(res.body).not.toHaveProperty("refreshToken");
    expect(res.body).toHaveProperty("expiresIn", "1h");
    expect(res.body).toHaveProperty("refreshTokenExpiresIn", "30d");

    expect(res.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: "admin",
      organisation_id: organisation.id,
    });

    const decoded = jwt.decode(res.body.token);
    expect(decoded).toHaveProperty("session_id");
    expect(decoded).toHaveProperty("token_type", "access");
    expect(decoded).toHaveProperty("organisation_id", organisation.id);
    expect(decoded.exp - decoded.iat).toBe(60 * 60);

    const cookies = res.headers["set-cookie"] || [];
    const accessCookie = cookies.find((c) => c.startsWith("access_token="));
    const refreshCookie = cookies.find((c) => c.startsWith("refresh_token="));
    expect(accessCookie).toBeDefined();
    expect(accessCookie).toMatch(/HttpOnly/);
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/);
    expect(refreshCookie).toMatch(/SameSite=Strict/i);
    expect(refreshCookie).toMatch(/Max-Age=2592000/);
  });

  test("les routes protégées acceptent le cookie access_token sans Authorization", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Cookie Access ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const loginRes = await loginUser(user);
    const accessToken = loginRes.headers["set-cookie"]
      ?.find((cookie) => cookie.startsWith("access_token="))
      ?.match(/access_token=([^;]+)/)?.[1];

    expect(accessToken).toBeDefined();

    const res = await request(app)
      .get("/api/activity/summary?date_debut=2026-05-01&date_fin=2026-05-21")
      .set("Cookie", `access_token=${accessToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("POST /api/login crée une session et POST /api/logout la clôture", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Logout ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const loginRes = await loginUser(user);
    expect(loginRes.statusCode).toBe(200);

    const decoded = jwt.decode(loginRes.body.token);
    expect(decoded).toHaveProperty("session_id");

    const before = await db.query(`SELECT id, active, logout_time FROM user_sessions WHERE id = $1`, [decoded.session_id]);

    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].active).toBe(true);
    expect(before.rows[0].logout_time).toBeNull();

    const logoutRes = await request(app).post("/api/logout").set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.body).toEqual({ success: true });

    const after = await db.query(`SELECT id, active, logout_time FROM user_sessions WHERE id = $1`, [decoded.session_id]);

    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].active).toBe(false);
    expect(after.rows[0].logout_time).not.toBeNull();
  });

  test("POST /api/logout révoque la session via le refresh cookie si l'access token est expiré", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Logout Expired ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });
    const loginRes = await loginUser(user);
    const sessionId = jwt.decode(loginRes.body.token).session_id;
    const refreshToken = loginRes.headers["set-cookie"]?.[0]?.match(/refresh_token=([^;]+)/)?.[1];
    const expiredAccessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organisation_id: organisation.id,
        session_id: sessionId,
        token_type: "access",
      },
      process.env.JWT_SECRET,
      { expiresIn: -1 },
    );

    const logoutRes = await request(app)
      .post("/api/logout")
      .set("Authorization", `Bearer ${expiredAccessToken}`)
      .set("Cookie", `refresh_token=${refreshToken}`);

    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.body).toEqual({ success: true });
    expect(logoutRes.headers["set-cookie"]?.join(";")).toMatch(/refresh_token=;/);

    const session = await db.query(`SELECT active, logout_time FROM user_sessions WHERE id = $1`, [sessionId]);
    const refreshTokens = await db.query(`SELECT revoked_at FROM refresh_tokens WHERE session_id = $1`, [sessionId]);

    expect(session.rows[0].active).toBe(false);
    expect(session.rows[0].logout_time).not.toBeNull();
    expect(refreshTokens.rows.every((row) => row.revoked_at)).toBe(true);

    const refreshRes = await request(app).post("/api/refresh").set("Cookie", `refresh_token=${refreshToken}`).send({});

    expect(refreshRes.statusCode).toBe(401);
  });

  test("POST /api/logout refuse sans token mais accepte un token invalide en nettoyant le cookie", async () => {
    const missing = await request(app).post("/api/logout");
    expect(missing.statusCode).toBe(401);

    const invalid = await request(app).post("/api/logout").set("Authorization", "Bearer token-invalide");

    expect(invalid.statusCode).toBe(200);
    expect(invalid.body).toEqual({ success: true });
  });

  test("POST /api/refresh renouvelle et invalide l'ancien refresh token", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Refresh ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const loginRes = await loginUser(user);
    expect(loginRes.statusCode).toBe(200);

    const oldRefreshToken = loginRes.headers["set-cookie"]?.[0]?.match(/refresh_token=([^;]+)/)?.[1];
    expect(oldRefreshToken).toBeDefined();

    const refreshRes = await request(app).post("/api/refresh").send({
      refreshToken: oldRefreshToken,
    });

    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.body).toHaveProperty("success", true);
    expect(refreshRes.body).toHaveProperty("token");
    expect(refreshRes.body).not.toHaveProperty("refreshToken");
    expect(refreshRes.body.user).toHaveProperty("organisation_id", organisation.id);

    const newRefreshToken = refreshRes.headers["set-cookie"]?.[0]?.match(/refresh_token=([^;]+)/)?.[1];
    const rotatedDecoded = jwt.decode(newRefreshToken);

    expect(rotatedDecoded).toHaveProperty("token_type", "refresh");
    expect(rotatedDecoded).toHaveProperty("session_id", jwt.decode(loginRes.body.token).session_id);
    expect(rotatedDecoded).toHaveProperty("organisation_id", organisation.id);

    const replayRes = await request(app).post("/api/refresh").send({
      refreshToken: oldRefreshToken,
    });

    expect(replayRes.statusCode).toBe(401);
    expect(replayRes.apiResponse).toHaveProperty("success", false);
  });

  test("POST /api/refresh lit le refresh token depuis le cookie", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Cookie Refresh ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const loginRes = await loginUser(user);
    expect(loginRes.statusCode).toBe(200);

    const refreshToken = loginRes.headers["set-cookie"]?.[0]?.match(/refresh_token=([^;]+)/)?.[1];
    expect(refreshToken).toBeDefined();

    const res = await request(app).post("/api/refresh").set("Cookie", `refresh_token=${refreshToken}`).send({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("token");
  });
});
