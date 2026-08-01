// Preuve d'exécution réelle des contrôles de permission HTTP sur les
// nouvelles routes /accounting/tax-filing-periods : la création d'une
// période et son dépôt sont des opérations de gouvernance financière
// réservées au rôle admin ; la consultation du rapport reste ouverte.
const express = require("express");
const request = require("supertest");
const { createTestOrganisation } = require("./helpers/testData");

const mockState = { organisationId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: 1, role };
  next();
}

const accountingRoutes = require("../routes/business/accounting.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/accounting", accountingRoutes);
  return app;
}

describe("Permissions HTTP — périodes fiscales (domaine 1.I)", () => {
  let app;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Remise Taxes Permissions E2E Org" });
    mockState.organisationId = org.id;
    app = buildApp();
  });

  test("un employé ne peut pas créer de période fiscale", async () => {
    const res = await request(app)
      .post("/api/accounting/tax-filing-periods")
      .set("x-test-role", "employe")
      .send({ frequency: "monthly", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(res.status).toBe(403);
  });

  test("un employé peut consulter la liste des périodes fiscales (lecture seule)", async () => {
    const res = await request(app)
      .get("/api/accounting/tax-filing-periods")
      .set("x-test-role", "employe");
    expect(res.status).toBe(200);
    expect(res.body.periods).toEqual([]);
  });

  test("un admin peut créer une période fiscale et consulter son rapport ; un employé ne peut pas la déposer", async () => {
    const created = await request(app)
      .post("/api/accounting/tax-filing-periods")
      .set("x-test-role", "admin")
      .send({ frequency: "monthly", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(created.status).toBe(201);

    const report = await request(app)
      .get(`/api/accounting/tax-filing-periods/${created.body.period.id}/remittance-report`)
      .set("x-test-role", "employe");
    expect(report.status).toBe(200);
    expect(report.body.report.netAmount).toBe(0);

    const fileAttempt = await request(app)
      .post(`/api/accounting/tax-filing-periods/${created.body.period.id}/file`)
      .set("x-test-role", "employe")
      .send({});
    expect(fileAttempt.status).toBe(403);
  });
});
