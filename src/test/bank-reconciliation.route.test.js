// Preuve d'exécution réelle des contrôles de permission HTTP sur les
// nouvelles routes /accounting/bank-reconciliation : la création d'un
// relevé, l'ajout de lignes, la correspondance et le verrouillage sont des
// opérations de gouvernance financière réservées au rôle admin.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { seedDefaultChart } = require("../services/business/accounting.service");

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

describe("Permissions HTTP — rapprochement bancaire (domaine 1.G)", () => {
  let app;
  let bankAccountId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Rapprochement Permissions E2E Org" });
    mockState.organisationId = org.id;
    await seedDefaultChart(db.pool, org.id);
    const account = await db.pool.query(`SELECT id FROM accounting_accounts WHERE organisation_id=$1 AND code='1010'`, [org.id]);
    bankAccountId = account.rows[0].id;
    app = buildApp();
  });

  test("un employé ne peut pas créer un relevé bancaire", async () => {
    const res = await request(app)
      .post("/api/accounting/bank-reconciliation/statements")
      .set("x-test-role", "employe")
      .send({ accountId: bankAccountId, periodStart: "2026-01-01", periodEnd: "2026-01-31", openingBalance: 0, closingBalance: 0 });
    expect(res.status).toBe(403);
  });

  test("un employé peut consulter la liste des relevés (lecture seule)", async () => {
    const res = await request(app)
      .get("/api/accounting/bank-reconciliation/statements")
      .set("x-test-role", "employe");
    expect(res.status).toBe(200);
    expect(res.body.statements).toEqual([]);
  });

  test("un admin peut créer un relevé bancaire", async () => {
    const res = await request(app)
      .post("/api/accounting/bank-reconciliation/statements")
      .set("x-test-role", "admin")
      .send({ accountId: bankAccountId, periodStart: "2026-01-01", periodEnd: "2026-01-31", openingBalance: 0, closingBalance: 0 });
    expect(res.status).toBe(201);
    expect(res.body.statement.status).toBe("open");
  });

  test("un employé peut consulter les suggestions de correspondance mais pas les appliquer", async () => {
    const created = await request(app)
      .post("/api/accounting/bank-reconciliation/statements")
      .set("x-test-role", "admin")
      .send({ accountId: bankAccountId, periodStart: "2026-02-01", periodEnd: "2026-02-28", openingBalance: 0, closingBalance: 0 });
    const statementId = created.body.statement.id;

    const suggestions = await request(app)
      .get(`/api/accounting/bank-reconciliation/statements/${statementId}/suggested-matches`)
      .set("x-test-role", "employe");
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.suggestions).toEqual([]);

    const apply = await request(app)
      .post(`/api/accounting/bank-reconciliation/statements/${statementId}/apply-suggested-matches`)
      .set("x-test-role", "employe")
      .send({ confirmedByHuman: true });
    expect(apply.status).toBe(403);
  });
});
