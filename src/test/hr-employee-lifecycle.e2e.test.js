// Bug réel trouvé en construisant la matrice de compétences par poste :
// hr-transaction.service.test.js (préexistant) ne teste que les fonctions
// pures de politique de createEmployee/transitionEmployment/decideLeave/
// verifyCompetency -- jamais ces quatre chemins d'écriture réels contre une
// vraie base. Les quatre échouaient en réalité (500, "invalid input syntax
// for type uuid") car ct_mad_transaction_id était typé UUID alors que
// createTransactionId() produit "CTM-<année>-<uuid>", un format que tous
// les autres modules stockent en TEXT/VARCHAR. Ce test exécute les quatre
// chemins par de vraies requêtes HTTP contre une vraie base, prouvant que
// la correction de type fonctionne réellement.
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
  const userId = req.header("x-test-user-id");
  if (role) req.user = { id: userId ? Number(userId) : null, role };
  next();
}

const hrRoutes = require("../routes/business/hr.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/hr", hrRoutes);
  return app;
}

describe("Cycle de vie employé RH — correction du type ct_mad_transaction_id", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("createEmployee : écriture réelle réussie, ct_mad_transaction_id au format CTM-<année>-<uuid>", async () => {
    const org = await createTestOrganisation({ nom: "HR Employee Lifecycle E2E Create" });
    mockState.organisationId = org.id;

    const created = await request(app)
      .post("/api/hr/employees")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeNumber: `E-${Date.now()}`, legalName: "Test Employé", hireDate: "2026-01-01", idempotencyKey: "emp-create-0001" });
    expect(created.status).toBe(201);
    expect(created.body.employee.employment_status).toBe("draft");

    const stored = await db.pool.query("SELECT ct_mad_transaction_id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [org.id, created.body.employee.id]);
    expect(stored.rows[0].ct_mad_transaction_id).toMatch(/^CTM-\d{4}-/);

    // Idempotence : rejouer la même clé retourne le même employé.
    const replay = await request(app)
      .post("/api/hr/employees")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeNumber: `E-REPLAY-${Date.now()}`, legalName: "Autre Nom", hireDate: "2026-01-01", idempotencyKey: "emp-create-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  test("transitionEmployment : activation réelle réussie", async () => {
    const org = await createTestOrganisation({ nom: "HR Employee Lifecycle E2E Transition" });
    mockState.organisationId = org.id;

    const created = await request(app)
      .post("/api/hr/employees")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeNumber: `E-${Date.now()}`, legalName: "Test Transition", hireDate: "2026-01-01", idempotencyKey: "emp-transition-create-0001" });
    const employeeId = created.body.employee.id;

    const activated = await request(app)
      .post(`/api/hr/employees/${employeeId}/transitions/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "emp-transition-0001" });
    expect(activated.status).toBe(200);
    expect(activated.body.employee.employment_status).toBe("active");
  });

  test("decideLeave : demande de congé créée et approuvée réellement", async () => {
    const org = await createTestOrganisation({ nom: "HR Employee Lifecycle E2E Leave" });
    mockState.organisationId = org.id;

    const created = await request(app)
      .post("/api/hr/employees")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeNumber: `E-${Date.now()}`, legalName: "Test Congé", hireDate: "2026-01-01", idempotencyKey: "emp-leave-create-0001" });
    const employeeId = created.body.employee.id;

    const leave = await request(app)
      .post("/api/hr/leave-requests")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId, leaveType: "vacation", startDate: "2026-08-10", endDate: "2026-08-14", requestedUnits: 5, idempotencyKey: "leave-create-0001" });
    expect(leave.status).toBe(201);

    const approved = await request(app)
      .post(`/api/hr/leave-requests/${leave.body.leaveRequest.id}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "leave-decide-0001" });
    expect(approved.status).toBe(200);
    expect(approved.body.request.status).toBe("approved");
  });

  test("verifyCompetency : compétence d'employé enregistrée réellement", async () => {
    const org = await createTestOrganisation({ nom: "HR Employee Lifecycle E2E Competency" });
    mockState.organisationId = org.id;

    const created = await request(app)
      .post("/api/hr/employees")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeNumber: `E-${Date.now()}`, legalName: "Test Compétence", hireDate: "2026-01-01", idempotencyKey: "emp-comp-create-0001" });
    const employeeId = created.body.employee.id;

    const competency = await request(app)
      .post("/api/hr/competencies")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "TEST-COMP", name: "Compétence de test" });

    const verified = await request(app)
      .post("/api/hr/employee-competencies")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId, competencyId: competency.body.competency.id, issuedAt: "2026-01-01", idempotencyKey: "comp-verify-0001" });
    expect(verified.status).toBe(201);
    expect(verified.body.employeeCompetency.status).toBe("valid");

    const stored = await db.pool.query("SELECT * FROM hr_employee_competencies WHERE organisation_id=$1 AND employee_id=$2", [org.id, employeeId]);
    expect(stored.rows).toHaveLength(1);
  });
});
