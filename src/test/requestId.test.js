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

  test("propage X-Correlation-ID si X-Request-ID est absent", async () => {
    const res = await request(app)
      .get("/api/route-inconnue")
      .set("X-Correlation-ID", "corr-test-456");

    expect(res.headers["x-request-id"]).toBe("corr-test-456");
  });

  test("génère un UUID v4 valide si aucun identifiant n’est fourni", async () => {
    const res = await request(app).get("/api/route-inconnue");

    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

});
