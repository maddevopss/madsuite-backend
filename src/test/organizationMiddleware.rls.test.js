const { EventEmitter } = require("events");
const db = require("../../db");
const { requireOrganisation } = require("../middleware/organization.middleware");

function createMockResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headersSent = false;
  res.headers = {};
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.setHeader = jest.fn((name, value) => {
    res.headers[name.toLowerCase()] = value;
    return res;
  });
  res.end = jest.fn((payload) => {
    res.headersSent = true;
    res.body = payload ?? res.body;
    res.emit("finish");
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return res;
  });
  return res;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("requireOrganisation RLS context", () => {
  test("sets app.current_organisation_id for req.db and db.query via AsyncLocalStorage", async () => {
    const req = {
      originalUrl: "/test/rls-context",
      user: {
        id: 1001,
        organisation_id: 4242,
      },
    };
    const res = createMockResponse();

    let nextErr = null;
    const nextPromise = new Promise((resolve, reject) => {
      const next = async (err) => {
        nextErr = err || null;
        if (err) {
          reject(err);
          return;
        }

        try {
          const fromReqClient = await req.db.query("SELECT current_setting('app.current_organisation_id') AS val");
          expect(fromReqClient.rows[0].val).toBe("4242");

          const fromDbStore = await db.query("SELECT current_setting('app.current_organisation_id') AS val");
          expect(fromDbStore.rows[0].val).toBe("4242");

          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      };

      requireOrganisation(req, res, next).catch(reject);
    });

    await nextPromise;
    expect(nextErr).toBeNull();
    expect(req.organisationId).toBe(4242);

    res.end();
    await tick();

    expect(res.headersSent).toBe(true);
  });

  test("rejects authenticated users without organisation context", async () => {
    const req = {
      originalUrl: "/test/rls-context",
      user: {
        id: 1002,
      },
    };
    const res = createMockResponse();
    const next = jest.fn();

    await requireOrganisation(req, res, next);
    await tick();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body?.code).toBe("ORGANISATION_REQUIRED");
  });
});