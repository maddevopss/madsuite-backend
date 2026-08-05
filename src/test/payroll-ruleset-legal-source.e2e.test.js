// Issue #363 — lacune confirmée : « les règles légales et fiscales doivent
// être versionnées, sourcées et validées avant toute prétention de
// conformité ». La version et la validation (activation par un admin)
// existaient déjà ; il manquait la source. Ce test exécute la vraie route
// payroll.routes.js contre une vraie base PostgreSQL et prouve : la création
// d'un jeu de règles sans source légale/fiscale est refusée (400), la
// source est persistée et exposée dans GET /rulesets, et l'activation d'un
// jeu de règles sans source est refusée par le service.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { activateRuleset } = require("../services/business/payroll-run-lifecycle.service");

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

const payrollRoutes = require("../routes/business/payroll.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/payroll", payrollRoutes);
  return app;
}

const RULES = { employeeDeductions: {}, employerContributions: {} };

describe("Paie — source légale/fiscale des jeux de règles (#363)", () => {
  let app;
  let TEST_ORG_ID;

  beforeAll(async () => {
    app = buildApp();
    const org = await createTestOrganisation();
    TEST_ORG_ID = org.id;
    mockState.organisationId = TEST_ORG_ID;
  });

  afterAll(async () => {
    await db.pool.end().catch(() => null);
  });

  test("POST /rulesets refuse la création sans source légale/fiscale", async () => {
    const res = await request(app)
      .post("/api/payroll/rulesets")
      .set("x-test-role", "admin")
      .send({ version: "NOSOURCE-1", effectiveFrom: "2026-01-01", rules: RULES });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/source/i);
  });

  test("POST /rulesets persiste la source et GET /rulesets l'expose", async () => {
    const created = await request(app)
      .post("/api/payroll/rulesets")
      .set("x-test-role", "admin")
      .send({
        version: "WITHSOURCE-1",
        effectiveFrom: "2026-01-01",
        rules: RULES,
        legalSource: "Revenu Québec — Guide TP-1015.G, éd. 2026",
      });
    expect(created.status).toBe(201);
    expect(created.body.ruleset.legal_source).toBe("Revenu Québec — Guide TP-1015.G, éd. 2026");

    const list = await request(app)
      .get("/api/payroll/rulesets")
      .set("x-test-role", "admin");
    expect(list.status).toBe(200);
    const match = list.body.rulesets.find((r) => r.version === "WITHSOURCE-1");
    expect(match?.legal_source).toBe("Revenu Québec — Guide TP-1015.G, éd. 2026");
  });

  test("l'activation refuse un jeu de règles historique sans source légale/fiscale", async () => {
    const { checksumRules } = require("../services/business/payroll-run-lifecycle.service");
    const checksum = checksumRules(RULES);
    const legacy = await db.pool.query(
      `INSERT INTO payroll_rulesets (organisation_id, version, province, effective_from, rules, checksum, status)
       VALUES ($1,'LEGACY-NOSOURCE','QC','2026-01-01',$2,$3,'draft') RETURNING *`,
      [TEST_ORG_ID, JSON.stringify(RULES), checksum],
    );
    await expect(
      activateRuleset(db.pool, TEST_ORG_ID, legacy.rows[0].id, null),
    ).rejects.toThrow(/source légale/);
  });
});
