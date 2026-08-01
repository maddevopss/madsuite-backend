// Preuve d'exécution réelle du domaine 4 (paie), fin d'emploi et relevé
// d'emploi (ROE). Cartographie préalable : payroll-terminations.routes.js
// est réellement monté (/api/payroll/remittances/terminations, via
// payroll-remittances.routes.js), et sa logique pure (buildFinalPay,
// buildRoePayload) a des tests unitaires, mais aucun test n'exécutait de
// vraie requête SQL contre ce routeur. Ce test exécute le cycle complet
// draft → approved → issued via de vraies requêtes HTTP contre une vraie
// base : contrôle de rôle à deux niveaux, unicité d'une fin d'emploi par
// employé/date, calcul de la paie finale, construction et persistance du
// relevé d'emploi (roe_payload jsonb), transitions d'état invalides
// refusées, et isolation multi-organisation.
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

const payrollRemittancesRoutes = require("../routes/business/payroll-remittances.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/payroll/remittances", payrollRemittancesRoutes);
  return app;
}

async function seedEmployee(organisationId, overrides = {}) {
  const base = {
    employeeNumber: `E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    legalName: "Test Employee",
    legalFirstName: "Test",
    legalLastName: "Employee",
    hireDate: "2020-01-01",
    payType: "hourly",
    hourlyRate: 25,
    ...overrides,
  };
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_employees
      (organisation_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [organisationId, base.employeeNumber, base.legalName, base.legalFirstName, base.legalLastName, base.hireDate, base.payType, base.hourlyRate],
  );
  return rows[0];
}

describe("Fin d'emploi et relevé d'emploi — cycle complet (domaine 4)", () => {
  let app;
  let orgId;
  let employeeId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Termination ROE E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();
    const employee = await seedEmployee(orgId);
    employeeId = employee.id;
  });

  test("un employé sans rôle admin/manager ne peut ni lister ni créer de fin d'emploi", async () => {
    const list = await request(app).get("/api/payroll/remittances/terminations").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "employe")
      .send({ employeeId, lastWorkedDate: "2026-06-30", finalPayDate: "2026-07-04", reasonCode: "M01" });
    expect(create.status).toBe(403);
  });

  test("validations : employé, dernière journée travaillée, date de paie finale et motif obligatoires", async () => {
    const missingReason = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "manager")
      .send({ employeeId, lastWorkedDate: "2026-06-30", finalPayDate: "2026-07-04" });
    expect(missingReason.status).toBe(400);

    const missingEmployee = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "manager")
      .send({ lastWorkedDate: "2026-06-30", finalPayDate: "2026-07-04", reasonCode: "M01" });
    expect(missingEmployee.status).toBe(400);
  });

  test("création réelle par un manager : paie finale calculée, statut draft", async () => {
    const res = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "manager")
      .send({
        employeeId,
        lastWorkedDate: "2026-06-30",
        finalPayDate: "2026-07-04",
        reasonCode: "M01",
        regular: 1200,
        vacationPayout: 300.5,
        severanceAmount: 500,
        otherAmount: 25,
      });
    expect(res.status).toBe(201);
    expect(res.body.termination.status).toBe("draft");
    expect(Number(res.body.termination.vacation_payout)).toBe(300.5);
    expect(Number(res.body.termination.severance_amount)).toBe(500);
    expect(Number(res.body.termination.other_amount)).toBe(25);

    // Une deuxième fin d'emploi pour le même employé à la même date est
    // rejetée (unicité organisation_id/employee_id/last_day_worked).
    const duplicate = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "manager")
      .send({ employeeId, lastWorkedDate: "2026-06-30", finalPayDate: "2026-07-04", reasonCode: "M01" });
    expect(duplicate.status).toBe(409);
  });

  test("cycle de transition complet : approbation réservée admin, émission avec relevé d'emploi persisté", async () => {
    const employee2 = await seedEmployee(orgId);
    const created = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "manager")
      .send({ employeeId: employee2.id, lastWorkedDate: "2026-08-15", finalPayDate: "2026-08-20", reasonCode: "A01" });
    const id = created.body.termination.id;

    const managerApprove = await request(app).post(`/api/payroll/remittances/terminations/${id}/approve`).set("x-test-role", "manager");
    expect(managerApprove.status).toBe(403);

    const issueBeforeApprove = await request(app).post(`/api/payroll/remittances/terminations/${id}/issue`).set("x-test-role", "admin")
      .send({ roeReference: "ROE-0001" });
    expect(issueBeforeApprove.status).toBe(409);

    const approved = await request(app).post(`/api/payroll/remittances/terminations/${id}/approve`).set("x-test-role", "admin");
    expect(approved.status).toBe(200);
    expect(approved.body.termination.status).toBe("approved");

    const issueWithoutReference = await request(app).post(`/api/payroll/remittances/terminations/${id}/issue`).set("x-test-role", "admin").send({});
    expect(issueWithoutReference.status).toBe(400);

    const issued = await request(app).post(`/api/payroll/remittances/terminations/${id}/issue`).set("x-test-role", "admin")
      .send({ roeReference: "ROE-0001" });
    expect(issued.status).toBe(200);
    expect(issued.body.termination.status).toBe("issued");
    expect(issued.body.termination.issued_at).toBeTruthy();
    expect(issued.body.termination.roe_payload).toEqual({
      employeeNumber: employee2.employee_number,
      lastDayWorked: "2026-08-15T00:00:00.000Z",
      finalPayDate: "2026-08-20T00:00:00.000Z",
      reasonCode: "A01",
      roeReference: "ROE-0001",
    });

    // Émettre deux fois est refusé (déjà "issued").
    const reissue = await request(app).post(`/api/payroll/remittances/terminations/${id}/issue`).set("x-test-role", "admin")
      .send({ roeReference: "ROE-0002" });
    expect(reissue.status).toBe(409);
  });

  test("annulation possible depuis draft/approved, action inconnue rejetée, fin d'emploi introuvable en 404", async () => {
    const employee3 = await seedEmployee(orgId);
    const created = await request(app).post("/api/payroll/remittances/terminations").set("x-test-role", "manager")
      .send({ employeeId: employee3.id, lastWorkedDate: "2026-09-15", finalPayDate: "2026-09-20", reasonCode: "E01" });
    const id = created.body.termination.id;

    const unknownAction = await request(app).post(`/api/payroll/remittances/terminations/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const cancelled = await request(app).post(`/api/payroll/remittances/terminations/${id}/cancel`).set("x-test-role", "admin");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.termination.status).toBe("cancelled");

    const approveAfterCancel = await request(app).post(`/api/payroll/remittances/terminations/${id}/approve`).set("x-test-role", "admin");
    expect(approveAfterCancel.status).toBe(409);

    const notFound = await request(app).post(`/api/payroll/remittances/terminations/999999/approve`).set("x-test-role", "admin");
    expect(notFound.status).toBe(404);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Termination ROE E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/payroll/remittances/terminations").set("x-test-role", "admin");
      expect(list.body.terminations).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
