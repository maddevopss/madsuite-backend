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

async function pickRefreshTokenFromSetCookie(res) {
  const cookies = res.headers["set-cookie"] || [];
  return cookies.find((c) => c.startsWith("refresh_token="))?.match(/refresh_token=([^;]+)/)?.[1] || null;
}

describe("Auth / refresh flow (expired access token)", () => {
  test("expired access token -> refresh via cookie -> protected endpoint OK", async () => {
    const organisation = await createTestOrganisation({ nom: `Org Refresh Expired ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });

    const loginRes = await loginUser(user);
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body).toHaveProperty("token");

    const refreshToken = await pickRefreshTokenFromSetCookie(loginRes);
    expect(refreshToken).toBeTruthy();

    const decodedAccess = jwt.decode(loginRes.body.token);
    const sessionId = decodedAccess.session_id;

    // Protected endpoint: choose a stable one that requires auth and organisation scope.
    // GET /api/dashboard should be protected by auth + requiresOrganisation via requireOrganisation middleware.
    // If dashboard returns data depends on seed, but auth should pass.
    const protectedPath = "/api/dashboard";

    // Sanity: access with valid token.
    const okRes = await request(app).get(protectedPath).set("Authorization", `Bearer ${loginRes.body.token}`);

    // Some endpoints may still return 400 depending on query; but for auth success we expect 2xx/4xx not 401.
    expect(okRes.statusCode).not.toBe(401);

    // Craft an expired access token with same shape.
    const expiredAccessToken = jwt.sign(
      {
        id: user.id,
        role: user.role,
        organisation_id: organisation.id,
        session_id: sessionId,
        token_type: "access",
      },
      process.env.JWT_SECRET,
      { expiresIn: -1 },
    );

    const deniedRes = await request(app).get(protectedPath).set("Authorization", `Bearer ${expiredAccessToken}`);

    expect(deniedRes.statusCode).toBe(401);

    // Refresh via cookie.
    const refreshRes = await request(app).post("/api/refresh").set("Cookie", `refresh_token=${refreshToken}`).send({});

    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.body).toHaveProperty("token");
    expect(refreshRes.body).toHaveProperty("success", true);

    const newAccessToken = refreshRes.body.token;

    // Re-try protected endpoint with refreshed access token.
    const okAfterRefreshRes = await request(app).get(protectedPath).set("Authorization", `Bearer ${newAccessToken}`);

    expect(okAfterRefreshRes.statusCode).not.toBe(401);

    // Ensure refresh token rotation happened: previous refresh token hash should now be revoked.
    // We query refresh_tokens by token_hash.
    const { hashToken } = require("../services/authTokens");
    const oldHash = hashToken(refreshToken);

    const revokedCheck = await db.query(
      `SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1 ORDER BY id DESC LIMIT 1`,
      [oldHash],
    );

    // Rotation should revoke previous token; allow null if schema differs, but in this code it is expected.
    expect(revokedCheck.rows[0]?.revoked_at).not.toBeNull();
  });
});
