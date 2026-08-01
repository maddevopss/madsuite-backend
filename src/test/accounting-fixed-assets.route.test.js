// Preuve d'exécution réelle des contrôles de permission HTTP sur les
// nouvelles routes /accounting/fixed-assets : l'enregistrement d'un actif
// et l'exécution d'un lot d'amortissement sont des opérations de
// gouvernance financière réservées au rôle admin, cohérent avec le reste
// de accounting.routes.js (/entries/:id/reverse, /periods/:id/close...).
const express = require("express");
const request = require("supertest");
const db = require("../../db");
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

describe("Permissions HTTP — immobilisations (domaine 1.H)", () => {
  let app;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Immobilisations Permissions E2E Org" });
    mockState.organisationId = org.id;
    app = buildApp();
  });

  afterAll(async () => {
    await db.pool.query("DELETE FROM accounting_fixed_assets WHERE organisation_id=$1", [mockState.organisationId]);
  });

  test("un employé ne peut pas enregistrer un actif immobilisé", async () => {
    const res = await request(app)
      .post("/api/accounting/fixed-assets")
      .set("x-test-role", "employe")
      .send({ assetNumber: "EQ-PERM-001", name: "Test", acquisitionDate: "2026-01-01", inServiceDate: "2026-01-01", acquisitionCost: 100, usefulLifeMonths: 12, assetAccountId: 1, accumulatedDepreciationAccountId: 1, depreciationExpenseAccountId: 1 });
    expect(res.status).toBe(403);
  });

  test("un employé ne peut pas déclencher un lot d'amortissement", async () => {
    const res = await request(app)
      .post("/api/accounting/fixed-assets/depreciation-runs")
      .set("x-test-role", "employe")
      .send({ runDate: "2026-01-31", idempotencyKey: "perm-test-00000001" });
    expect(res.status).toBe(403);
  });

  test("un employé peut consulter la liste des actifs (lecture seule)", async () => {
    const res = await request(app)
      .get("/api/accounting/fixed-assets")
      .set("x-test-role", "employe");
    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([]);
  });

  test("un admin peut enregistrer un actif immobilisé", async () => {
    const accounts = await db.pool.query(
      `INSERT INTO accounting_accounts (organisation_id, code, name, account_type, normal_balance)
       VALUES ($1,'1590','Équipement test permission','asset','debit') RETURNING id`,
      [mockState.organisationId],
    );
    const res = await request(app)
      .post("/api/accounting/fixed-assets")
      .set("x-test-role", "admin")
      .send({
        assetNumber: "EQ-PERM-002",
        name: "Test admin",
        acquisitionDate: "2026-01-01",
        inServiceDate: "2026-01-01",
        acquisitionCost: 1200,
        usefulLifeMonths: 12,
        assetAccountId: accounts.rows[0].id,
        accumulatedDepreciationAccountId: accounts.rows[0].id,
        depreciationExpenseAccountId: accounts.rows[0].id,
      });
    expect(res.status).toBe(201);
    expect(res.body.asset.asset_number).toBe("EQ-PERM-002");
  });

  test("un employé ne peut pas céder un actif immobilisé", async () => {
    const asset = await db.pool.query(
      `SELECT id FROM accounting_fixed_assets WHERE organisation_id=$1 AND asset_number='EQ-PERM-002'`,
      [mockState.organisationId],
    );
    const res = await request(app)
      .post(`/api/accounting/fixed-assets/${asset.rows[0].id}/dispose`)
      .set("x-test-role", "employe")
      .send({ disposalDate: "2026-02-01", disposalProceeds: 0 });
    expect(res.status).toBe(403);
  });
});
