const request = require("supertest");
const jwt = require("jsonwebtoken");

function makeToken() {
  return jwt.sign(
    {
      id: 1,
      email: "ratelimit@example.com",
      role: "admin",
      organisation_id: 1,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("activity limiter routing", () => {
  let app;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock("../config/rateLimiters", () => {
      const makeLimiter = (name) => (req, res, next) => {
        res.set("x-test-limiter", name);
        next();
      };

      return {
        activityLimiter: makeLimiter("activity"),
        defaultLimiter: makeLimiter("default"),
        loginLimiter: makeLimiter("login"),
      };
    });

    app = require("../app");
  });

  afterEach(() => {
    jest.dontMock("../config/rateLimiters");
  });

  test("POST activity utilise activityLimiter, GET summary utilise defaultLimiter", async () => {
    const token = makeToken();

    const write = await request(app).post("/api/activity").set("Authorization", `Bearer ${token}`).send({
      app_name: "Code",
      window_title: "Limiter write",
      duration_seconds: 30,
    });

    expect(write.headers["x-test-limiter"]).toBe("activity");

    const summary = await request(app)
      .get("/api/activity/summary?date_debut=2026-05-01&date_fin=2026-05-22")
      .set("Authorization", `Bearer ${token}`);

    expect(summary.headers["x-test-limiter"]).toBe("default");
  });
});

