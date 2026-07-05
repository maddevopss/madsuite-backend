const db = require("../../db");
const { requireModule } = require("../middleware/requireModule");

jest.mock("../../db", () => ({
  query: jest.fn(),
}));

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("requireModule middleware", () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  test("throws immediately for unknown module keys", () => {
    expect(() => requireModule("unknown_module_key")).toThrow("Unknown MADSuite module");
  });

  test("uses canonical req.organisationId before req.user.organisation_id", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ plan_type: "pro" }] });

    const req = {
      organisationId: 123,
      user: { organisation_id: 999 },
    };
    const res = createRes();
    const next = jest.fn();

    await requireModule("reports")(req, res, next);

    expect(db.query).toHaveBeenCalledWith(
      "SELECT plan_type FROM organisations WHERE id = $1",
      [123]
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("allows explicitly enabled addon modules", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ plan_type: "solo" }] })
      .mockResolvedValueOnce({ rows: [{ is_active: true }] });

    const req = { organisationId: 123, user: { id: 1 } };
    const res = createRes();
    const next = jest.fn();

    await requireModule("quotes")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("denies unavailable modules with stable 403", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ plan_type: "solo" }] })
      .mockResolvedValueOnce({ rows: [{ is_active: false }] });

    const req = { organisationId: 123, user: { id: 1 } };
    const res = createRes();
    const next = jest.fn();

    await requireModule("quotes")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: "MODULE_NOT_AVAILABLE",
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
