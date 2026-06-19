const request = require("supertest");

const app = require("../app");

describe("Health check", () => {
  test("GET /api/health verifie aussi PostgreSQL", async () => {
    const res = await request(app).get("/api/health");

    expect(res.statusCode).toBe(200);
    expect(res.apiResponse).toMatchObject({
      success: true,
      code: "HEALTH_OK",
      data: {
        status: "ok",
        database: "ok",
        environment: "test",
      },
    });
    expect(new Date(res.apiResponse.timestamp).toISOString()).toBe(res.apiResponse.timestamp);
  });
});
