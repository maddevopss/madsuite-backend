const db = require("../../db");
const { requireModule } = require("../middleware/requireModule");
const ApiResponse = require("../utils/apiResponse");

// Mock db
jest.mock("../../db");

describe("requireModule middleware - admin plan", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      organisationId: 1,
      user: { organisation_id: 1 },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  test("admin plan allows access to FREE modules", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "admin" }] });

    const middleware = requireModule("clients");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("admin plan allows access to PRO modules", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "admin" }] });

    const middleware = requireModule("invoices");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("admin plan allows access to ADDON modules", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "admin" }] });

    const middleware = requireModule("estimates");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("admin plan allows access to INTERNAL modules", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "admin" }] });

    const middleware = requireModule("cognitive_engine");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("admin plan allows access to desktop_agent", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "admin" }] });

    const middleware = requireModule("desktop_agent");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("free plan denies access to INTERNAL modules", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "free" }] });
    db.query.mockResolvedValueOnce({ rows: [] }); // No explicit enable

    const middleware = requireModule("cognitive_engine");
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("pro plan denies access to INTERNAL modules", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "pro" }] });
    db.query.mockResolvedValueOnce({ rows: [] }); // No explicit enable

    const middleware = requireModule("desktop_agent");
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("all internal plan types allow INTERNAL modules", async () => {
    const internalPlanTypes = ["admin", "internal", "master_admin", "platform_admin"];

    for (const planType of internalPlanTypes) {
      jest.clearAllMocks();
      db.query.mockResolvedValueOnce({ rows: [{ plan_type: planType }] });

      const middleware = requireModule("cognitive_engine");
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});
