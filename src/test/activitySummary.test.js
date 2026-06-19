const request = require("supertest");
const app = require("../app");
const db = require("../../db");
const jwt = require("jsonwebtoken");

function makeToken(role = "admin") {
  return jwt.sign(
    {
      id: 999,
      email: "test@example.com",
      role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}
describe("Activity summary routes", () => {
  test("GET /api/activity/summary refuse sans token", async () => {
    const res = await request(app).get("/api/activity/summary");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/activity/summary refuse sans dates", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/activity/summary").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/activity/summary refuse sans dates", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/activity/summary").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/activity/summary refuse avec seulement date_debut", async () => {
    const token = makeToken("admin");

    const res = await request(app)
      .get("/api/activity/summary?date_debut=2026-05-01")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/activity/summary accepte avec période complète", async () => {
    const token = makeToken("admin");

    const res = await request(app)
      .get("/api/activity/summary?date_debut=2026-05-01&date_fin=2026-05-21")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
