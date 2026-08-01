// Preuve d'exécution réelle pour l'issue #318, écart #4 (protection des
// renseignements sensibles). payroll-block-closure.contract.test.js et
// payroll-complete-integration.contract.test.js ne vérifient que la présence
// textuelle de "/runs/:id/pay-stubs" dans le code source — jamais que le
// filtrage par employé se comporte réellement comme attendu. Ce test monte
// le vrai routeur payroll.routes.js contre une vraie base PostgreSQL et
// prouve : un employé ne voit que son propre talon, un employé sans dossier
// de paie associé est refusé, un préparateur/approbateur voit tout, et les
// exports/le registre restent hors de portée du libre-service employé.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

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
  const userId = req.header("x-test-user-id");
  if (role) req.user = { id: userId ? Number(userId) : null, role };
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

describe("Permissions paie — talons employé vs préparateur/approbateur (#318)", () => {
  let app;
  let runId;
  let TEST_ORG_ID;
  let selfEmployeeUserId;
  let unrelatedUserId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Paie Permissions E2E Org" });
    TEST_ORG_ID = org.id;
    mockState.organisationId = org.id;
    app = buildApp();

    const selfUser = await createTestUser({ role: "employe", organisation_id: org.id, nom: "Employé Soi-même" });
    const otherUser = await createTestUser({ role: "employe", organisation_id: org.id, nom: "Employé Collègue" });
    const unrelatedUser = await createTestUser({ role: "employe", organisation_id: org.id, nom: "Employé Sans Dossier" });
    selfEmployeeUserId = selfUser.id;
    unrelatedUserId = unrelatedUser.id;

    const employeeSelf = await db.pool.query(
      `INSERT INTO payroll_employees
        (organisation_id, user_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate)
       VALUES ($1,$2,'E-SELF','Employé Soi-même','Employé','Soi-même','2020-01-01','hourly',20)
       RETURNING *`,
      [TEST_ORG_ID, selfEmployeeUserId],
    );
    const employeeOther = await db.pool.query(
      `INSERT INTO payroll_employees
        (organisation_id, user_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate)
       VALUES ($1,$2,'E-OTHER','Employé Collègue','Employé','Collègue','2020-01-01','hourly',22)
       RETURNING *`,
      [TEST_ORG_ID, otherUser.id],
    );

    const ruleset = await db.pool.query(
      `INSERT INTO payroll_rulesets (organisation_id, version, province, effective_from, rules, checksum, status)
       VALUES ($1,'PERM-TEST-1','QC','2026-01-01','{}'::jsonb,'x','active') RETURNING *`,
      [TEST_ORG_ID],
    );

    const run = await db.pool.query(
      `INSERT INTO payroll_runs (organisation_id, period_start, period_end, pay_date, ruleset_id, ruleset_version, status, totals)
       VALUES ($1,'2026-07-01','2026-07-14','2026-07-18',$2,'PERM-TEST-1','calculated','{}'::jsonb) RETURNING *`,
      [TEST_ORG_ID, ruleset.rows[0].id],
    );
    runId = run.rows[0].id;

    for (const employee of [employeeSelf.rows[0], employeeOther.rows[0]]) {
      await db.pool.query(
        `INSERT INTO payroll_run_lines
          (organisation_id, payroll_run_id, employee_id, regular_hours, overtime_hours, gross_pay, deductions, employer_contributions, net_pay, calculation_trace, source_snapshot, ruleset_version, calculation_checksum)
         VALUES ($1,$2,$3,40,0,800,'{}'::jsonb,'{}'::jsonb,800,'{}'::jsonb,'{}'::jsonb,'PERM-TEST-1','chk')`,
        [TEST_ORG_ID, runId, employee.id],
      );
    }
  });

  test("un employé ne voit que son propre talon de paie", async () => {
    const res = await request(app)
      .get(`/api/payroll/runs/${runId}/pay-stubs`)
      .set("x-test-role", "employe")
      .set("x-test-user-id", String(selfEmployeeUserId));

    expect(res.status).toBe(200);
    expect(res.body.payStubs).toHaveLength(1);
  });

  test("un employé sans dossier de paie associé est refusé", async () => {
    const res = await request(app)
      .get(`/api/payroll/runs/${runId}/pay-stubs`)
      .set("x-test-role", "employe")
      .set("x-test-user-id", String(unrelatedUserId));

    expect(res.status).toBe(403);
  });

  test("un admin voit tous les talons du cycle", async () => {
    const res = await request(app)
      .get(`/api/payroll/runs/${runId}/pay-stubs`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");

    expect(res.status).toBe(200);
    expect(res.body.payStubs).toHaveLength(2);
  });

  test("le registre complet est hors de portée du libre-service employé", async () => {
    const res = await request(app)
      .get(`/api/payroll/runs/${runId}/register`)
      .set("x-test-role", "employe")
      .set("x-test-user-id", String(selfEmployeeUserId));

    expect(res.status).toBe(403);
  });

  test("l'export CSV du registre est réservé au préparateur/approbateur, pas au libre-service", async () => {
    const asManager = await request(app)
      .get(`/api/payroll/runs/${runId}/register/export.csv`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", "2");
    expect(asManager.status).toBe(200);

    const asEmployee = await request(app)
      .get(`/api/payroll/runs/${runId}/register/export.csv`)
      .set("x-test-role", "employe")
      .set("x-test-user-id", String(selfEmployeeUserId));
    expect(asEmployee.status).toBe(403);
  });
});
