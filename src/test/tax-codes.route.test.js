// Preuve d'exécution réelle des contrôles de permission HTTP sur les
// nouvelles routes /accounting/tax-codes : la création et l'activation
// d'un profil de taxe sont des opérations de gouvernance financière
// réservées au rôle admin.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

const mockState = { organisationId: null, userId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: mockState.userId, role };
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

describe("Permissions HTTP — profils de taxes (domaine 1.I)", () => {
  let app;
  let taxAccountId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Taxes Permissions E2E Org" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    mockState.userId = user.id;
    const account = await db.pool.query(
      `INSERT INTO accounting_accounts (organisation_id, code, name, account_type, normal_balance)
       VALUES ($1,'2198','TPS test permission','liability','credit') RETURNING id`,
      [org.id],
    );
    taxAccountId = account.rows[0].id;
    app = buildApp();
  });

  test("un employé ne peut pas créer de profil de taxe", async () => {
    const res = await request(app)
      .post("/api/accounting/tax-codes")
      .set("x-test-role", "employe")
      .send({ code: "TPS", name: "TPS 5%", rate: 0.05, taxType: "collected", accountId: taxAccountId, effectiveFrom: "2026-01-01" });
    expect(res.status).toBe(403);
  });

  test("un employé peut consulter la liste des profils de taxes (lecture seule)", async () => {
    const res = await request(app)
      .get("/api/accounting/tax-codes")
      .set("x-test-role", "employe");
    expect(res.status).toBe(200);
    expect(res.body.taxCodes).toEqual([]);
  });

  test("un admin peut créer et activer un profil de taxe", async () => {
    const created = await request(app)
      .post("/api/accounting/tax-codes")
      .set("x-test-role", "admin")
      .send({ code: "TPS", name: "TPS 5%", rate: 0.05, taxType: "collected", accountId: taxAccountId, effectiveFrom: "2026-01-01" });
    expect(created.status).toBe(201);
    expect(created.body.taxCode.status).toBe("draft");

    const activated = await request(app)
      .post(`/api/accounting/tax-codes/${created.body.taxCode.id}/activate`)
      .set("x-test-role", "admin")
      .send({});
    expect(activated.status).toBe(200);
    expect(activated.body.taxCode.status).toBe("active");
  });

  test("un employé ne peut pas activer un profil de taxe", async () => {
    const created = await request(app)
      .post("/api/accounting/tax-codes")
      .set("x-test-role", "admin")
      .send({ code: "TVQ", name: "TVQ 9.975%", rate: 0.09975, taxType: "collected", accountId: taxAccountId, effectiveFrom: "2026-01-01" });

    const res = await request(app)
      .post(`/api/accounting/tax-codes/${created.body.taxCode.id}/activate`)
      .set("x-test-role", "employe")
      .send({});
    expect(res.status).toBe(403);
  });
});
