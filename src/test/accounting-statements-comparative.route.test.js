jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = 77;
    req.db = { query: jest.fn() };
    next();
  },
}));

jest.mock("../middleware/requireRole", () => () => (_req, _res, next) => next());

const mockGetComparativeStatements = jest.fn();

jest.mock("../services/business/accounting-statements-comparative.service", () => ({
  getComparativeStatements: (...args) => mockGetComparativeStatements(...args),
}));

const express = require("express");
const request = require("supertest");
const accountingRoutes = require("../routes/business/accounting.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/accounting", accountingRoutes);
  return app;
}

describe("GET /api/accounting/statements", () => {
  beforeEach(() => {
    mockGetComparativeStatements.mockReset();
  });

  test("transmet les deux périodes et retourne le contrat comparatif", async () => {
    const payload = {
      periods: {
        current: { startDate: "2026-01-01", endDate: "2026-01-31" },
        previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
      },
      statements: {
        incomeStatement: { netIncome: { current: 1250, previous: 900, variance: 350 } },
        balanceSheet: { isBalanced: true },
        cashFlow: { netChange: { current: 400, previous: 100, variance: 300 } },
      },
    };
    mockGetComparativeStatements.mockResolvedValue(payload);

    const response = await request(buildApp())
      .get("/api/accounting/statements")
      .query({
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        previousStartDate: "2025-12-01",
        previousEndDate: "2025-12-31",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(mockGetComparativeStatements).toHaveBeenCalledWith(
      expect.any(Object),
      77,
      {
        current: { startDate: "2026-01-01", endDate: "2026-01-31" },
        previous: { startDate: "2025-12-01", endDate: "2025-12-31" },
      },
    );
  });
});
