const requireSuperAdmin = require("../middleware/requireSuperAdmin");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(payload) {
      this.body = payload;
      return this;
    }),
  };
}

describe("requireSuperAdmin", () => {
  const originalMasterAdminIds = process.env.MASTER_ADMIN_USER_IDS;

  afterEach(() => {
    if (originalMasterAdminIds === undefined) {
      delete process.env.MASTER_ADMIN_USER_IDS;
    } else {
      process.env.MASTER_ADMIN_USER_IDS = originalMasterAdminIds;
    }
  });

  test("rejects unauthenticated requests with 401", () => {
    process.env.MASTER_ADMIN_USER_IDS = "1,2,3";
    const req = {};
    const res = createResponse();
    const next = jest.fn();

    requireSuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body?.code).toBe("UNAUTHORIZED");
  });

  test("fails closed when MASTER_ADMIN_USER_IDS is not configured", () => {
    delete process.env.MASTER_ADMIN_USER_IDS;
    const req = { user: { id: 1, role: "admin", organisation_id: 10 } };
    const res = createResponse();
    const next = jest.fn();

    requireSuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body?.code).toBe("FORBIDDEN");
  });

  test("rejects organisation admins that are not explicit platform super-admins", () => {
    process.env.MASTER_ADMIN_USER_IDS = "999,1000";
    const req = { user: { id: 42, role: "admin", organisation_id: 10 } };
    const res = createResponse();
    const next = jest.fn();

    requireSuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body?.code).toBe("FORBIDDEN");
  });

  test("allows explicit platform super-admins", () => {
    process.env.MASTER_ADMIN_USER_IDS = "999,1000";
    const req = { user: { id: 999, role: "admin", organisation_id: 10 } };
    const res = createResponse();
    const next = jest.fn();

    requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
