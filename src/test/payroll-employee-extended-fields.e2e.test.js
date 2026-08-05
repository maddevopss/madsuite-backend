// Suite de #698 (lacune documentée : payroll-employee-registry.service.js —
// les colonnes department_code/manager_employee_id/preferred_name/
// position_title/metadata existent en base (payroll_employees) depuis la
// migration 20260727230000_payroll_employee_registry.sql, mais n'étaient
// jamais exposées en écriture par POST/PATCH /employees ; GET les renvoyait
// déjà trivialement via SELECT * mais elles restaient NULL en pratique
// puisque rien ne permettait de les définir. Ce test exécute par de vraies
// requêtes HTTP contre une vraie base : création avec la fiche étendue
// complète (email normalisé, gestionnaire validé), création minimale sans
// aucun champ étendu (rétrocompatibilité), rejets de validation (statut
// d'emploi invalide, fin d'emploi avant embauche, gestionnaire inexistant ou
// d'une autre organisation, auto-gestion), et mise à jour partielle qui
// préserve les champs étendus non touchés tout en permettant d'effacer
// explicitement une date de fin d'emploi.
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

describe("Fiche employé étendue (suite #698)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("création avec fiche étendue complète : normalisation et gestionnaire validé", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Full" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "manager" });

    const manager = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({
        employeeNumber: "MGR-001",
        legalName: "Alex Gestionnaire",
        hireDate: "2020-01-01",
        payType: "salary",
        annualSalary: 90000,
      });
    expect(manager.status).toBe(201);

    const created = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({
        employeeNumber: "EMP-EXT-001",
        legalName: "Marie Tremblay",
        preferredName: " Mimi ",
        email: " MARIE@EXAMPLE.CA ",
        phone: "514-555-0100",
        departmentCode: "FIN",
        positionTitle: "Analyste financière",
        managerEmployeeId: manager.body.employee.id,
        metadata: { source: "onboarding", cohort: "2026-Q3" },
        hireDate: "2026-01-15",
        payType: "hourly",
        hourlyRate: 28,
      });
    expect(created.status).toBe(201);
    const employee = created.body.employee;
    expect(employee.preferred_name).toBe("Mimi");
    expect(employee.email).toBe("marie@example.ca");
    expect(employee.phone).toBe("514-555-0100");
    expect(employee.department_code).toBe("FIN");
    expect(employee.position_title).toBe("Analyste financière");
    expect(String(employee.manager_employee_id)).toBe(String(manager.body.employee.id));
    expect(employee.metadata).toEqual({ source: "onboarding", cohort: "2026-Q3" });

    // GET renvoie bien la fiche étendue persistée.
    const list = await request(app)
      .get("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id));
    const fetched = list.body.employees.find((e) => e.id === employee.id);
    expect(fetched.department_code).toBe("FIN");
    expect(fetched.metadata).toEqual({ source: "onboarding", cohort: "2026-Q3" });
  });

  test("création minimale sans champ étendu : rétrocompatibilité", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Minimal" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "manager" });

    const created = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({
        employeeNumber: "EMP-MIN-001",
        legalName: "Sam Ordinaire",
        hireDate: "2026-01-15",
        payType: "hourly",
        hourlyRate: 22,
      });
    expect(created.status).toBe(201);
    expect(created.body.employee.preferred_name).toBeNull();
    expect(created.body.employee.department_code).toBeNull();
    expect(created.body.employee.manager_employee_id).toBeNull();
    expect(created.body.employee.metadata).toEqual({});
  });

  test("rejette un statut d'emploi invalide à la création", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Validation" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "manager" });

    const badStatus = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({
        employeeNumber: "EMP-BAD-001",
        legalName: "Test Invalide",
        hireDate: "2026-01-15",
        payType: "hourly",
        hourlyRate: 20,
        employmentStatus: "on_vacation",
      });
    expect(badStatus.status).toBe(400);
  });

  test("rejette une fin d'emploi antérieure à l'embauche lors d'une mise à jour", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Validation Patch" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "manager" });

    const created = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({ employeeNumber: "EMP-BAD-003", legalName: "Test Dates", hireDate: "2026-07-20", payType: "hourly", hourlyRate: 20 });
    expect(created.status).toBe(201);

    const badDates = await request(app)
      .patch(`/api/payroll/employees/${created.body.employee.id}`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({ terminationDate: "2026-07-19" });
    expect(badDates.status).toBe(400);

    const stillNoTermination = await db.pool.query("SELECT termination_date FROM payroll_employees WHERE id=$1", [created.body.employee.id]);
    expect(stillNoTermination.rows[0].termination_date).toBeNull();
  });

  test("rejette un gestionnaire inexistant, un gestionnaire d'une autre organisation, et l'auto-gestion", async () => {
    const orgA = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Org B" });

    mockState.organisationId = orgB.id;
    const userB = await createTestUser({ organisation_id: orgB.id, role: "manager" });
    const foreignManager = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(userB.id))
      .send({ employeeNumber: "MGR-B-001", legalName: "Gestionnaire OrgB", hireDate: "2020-01-01", payType: "salary", annualSalary: 80000 });

    mockState.organisationId = orgA.id;
    const userA = await createTestUser({ organisation_id: orgA.id, role: "manager" });

    const missingManager = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(userA.id))
      .send({ employeeNumber: "EMP-A-001", legalName: "Test A", hireDate: "2026-01-15", payType: "hourly", hourlyRate: 20, managerEmployeeId: 999999 });
    expect(missingManager.status).toBe(400);

    const crossOrgManager = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(userA.id))
      .send({ employeeNumber: "EMP-A-002", legalName: "Test A2", hireDate: "2026-01-15", payType: "hourly", hourlyRate: 20, managerEmployeeId: foreignManager.body.employee.id });
    expect(crossOrgManager.status).toBe(400);

    const created = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(userA.id))
      .send({ employeeNumber: "EMP-A-003", legalName: "Test A3", hireDate: "2026-01-15", payType: "hourly", hourlyRate: 20 });
    const selfManager = await request(app)
      .patch(`/api/payroll/employees/${created.body.employee.id}`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(userA.id))
      .send({ managerEmployeeId: created.body.employee.id });
    expect(selfManager.status).toBe(400);
  });

  test("mise à jour partielle : préserve les champs étendus non touchés, permet d'effacer explicitement une date de fin d'emploi", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Extended Fields E2E Patch" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "manager" });

    const created = await request(app)
      .post("/api/payroll/employees")
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({
        employeeNumber: "EMP-PATCH-001",
        legalName: "Casey Test",
        preferredName: "Cas",
        departmentCode: "OPS",
        metadata: { note: "initial" },
        hireDate: "2026-01-15",
        payType: "hourly",
        hourlyRate: 24,
      });
    const id = created.body.employee.id;
    expect(created.body.employee.termination_date).toBeNull();

    // Définit d'abord une date de fin d'emploi (une création n'en accepte
    // jamais, seule une mise à jour le peut).
    const withTermination = await request(app)
      .patch(`/api/payroll/employees/${id}`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({ terminationDate: "2026-06-30" });
    expect(withTermination.status).toBe(200);
    expect(withTermination.body.employee.termination_date).not.toBeNull();

    // Ne modifie que positionTitle : preferredName/departmentCode/metadata doivent survivre intacts.
    const patched = await request(app)
      .patch(`/api/payroll/employees/${id}`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({ positionTitle: "Coordonnateur" });
    expect(patched.status).toBe(200);
    expect(patched.body.employee.position_title).toBe("Coordonnateur");
    expect(patched.body.employee.preferred_name).toBe("Cas");
    expect(patched.body.employee.department_code).toBe("OPS");
    expect(patched.body.employee.metadata).toEqual({ note: "initial" });

    // Efface explicitement la date de fin d'emploi (impossible avant : COALESCE
    // empêchait tout retour à NULL).
    const cleared = await request(app)
      .patch(`/api/payroll/employees/${id}`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(user.id))
      .send({ terminationDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.employee.termination_date).toBeNull();

    const persisted = await db.pool.query("SELECT termination_date, updated_by FROM payroll_employees WHERE id=$1", [id]);
    expect(persisted.rows[0].termination_date).toBeNull();
    expect(Number(persisted.rows[0].updated_by)).toBe(Number(user.id));
  });
});
