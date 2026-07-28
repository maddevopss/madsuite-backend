jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = { id: 1, organisation_id: 77 };
  next();
});

jest.mock("../middleware/requireModule", () => ({
  requireModule: () => (_req, _res, next) => next(),
}));

const mockQuery = jest.fn();
jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = 77;
    req.db = { query: mockQuery };
    next();
  },
}));

const request = require("supertest");
const app = require("../app");

describe("GET /api/payroll-compliance/summary", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: "due", dueDate: "2000-01-01" }] })
      .mockResolvedValueOnce({ rows: [{ availableAmount: "125.50" }] })
      .mockResolvedValueOnce({ rows: [{ status: "pending" }] })
      .mockResolvedValueOnce({ rows: [{ status: "confirmed", confirmedAt: "2026-07-27" }] })
      .mockResolvedValueOnce({ rows: [{ status: "draft" }] });
  });

  test("est montée dans app.js et retourne le résumé de conformité", async () => {
    const response = await request(app).get("/api/payroll-compliance/summary");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "attention_required",
      blockers: 3,
      overdueRemittances: 1,
      negativeVacationBanks: 0,
      pendingTerminations: 1,
      unconfirmedDeposits: 0,
      draftSlips: 1,
    });
    expect(mockQuery).toHaveBeenCalledTimes(5);
    for (const [, params] of mockQuery.mock.calls) {
      expect(params).toEqual([77]);
    }
  });
});
