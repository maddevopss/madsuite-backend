const request = require("supertest");

const app = require("../app");

describe("requestId middleware", () => {
  test("ajoute X-Request-ID si absent", async () => {
    const res = await request(app).get("/api/route-inconnue");

    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  test("propage X-Request-ID si fourni", async () => {
    const res = await request(app).get("/api/route-inconnue").set("X-Request-ID", "req-test-123");

    expect(res.headers["x-request-id"]).toBe("req-test-123");
  });
});
