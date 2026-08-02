// Structure organisationnelle RH (mandat 1.A/1.B) : hr_employees portait
// déjà manager_employee_id (hiérarchie individuelle) mais aucune entité
// "département" réelle n'existait -- nouvelle conception, contrairement aux
// PR précédentes de ce chantier (#705-#711) qui câblaient des orphelins.
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// création de départements (avec sous-départements), prévention de cycle
// dans la hiérarchie, rattachement d'un employé, organigramme, doublon de
// code, RBAC hérité et isolation multi-organisation.
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

async function seedEmployee(organisationId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO hr_employees (organisation_id, employee_number, legal_name) VALUES ($1,$2,'Employé Test') RETURNING *`,
    [organisationId, `E-DEPT-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Départements et organigramme RH (nouvelle conception)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("créer un département, un sous-département, rattacher un employé, consulter l'organigramme", async () => {
    const org = await createTestOrganisation({ nom: "HR Departments E2E Lifecycle" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "lifecycle");

    const parent = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "OPS", name: "Opérations", idempotencyKey: "dept-parent-0001" });
    expect(parent.status).toBe(201);
    const parentId = parent.body.department.id;

    const child = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "OPS-QC", name: "Opérations — Québec", parentDepartmentId: parentId, managerEmployeeId: employee.id, idempotencyKey: "dept-child-0001" });
    expect(child.status).toBe(201);
    expect(child.body.department.parent_department_id).toBe(parentId);
    expect(Number(child.body.department.manager_employee_id)).toBe(Number(employee.id));

    const assigned = await request(app)
      .patch(`/api/hr/employees/${employee.id}/department`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ departmentId: child.body.department.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.employee.department_id).toBe(child.body.department.id);

    const chart = await request(app)
      .get("/api/hr/organisation-chart")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(chart.status).toBe(200);
    expect(chart.body.departments.length).toBeGreaterThanOrEqual(2);
    const employeeInChart = chart.body.employees.find((e) => e.id === employee.id);
    expect(employeeInChart.department_id).toBe(child.body.department.id);
  });

  test("un cycle dans la hiérarchie des départements est refusé", async () => {
    const org = await createTestOrganisation({ nom: "HR Departments E2E Cycle" });
    mockState.organisationId = org.id;

    const a = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "A", name: "Département A", idempotencyKey: "dept-cycle-a-0001" });
    const b = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "B", name: "Département B", parentDepartmentId: a.body.department.id, idempotencyKey: "dept-cycle-b-0001" });

    // A ne peut pas devenir enfant de B, qui est déjà son propre enfant.
    const cycle = await request(app)
      .patch(`/api/hr/departments/${a.body.department.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ parentDepartmentId: b.body.department.id });
    expect(cycle.status).toBe(409);

    // Un département ne peut pas être son propre parent.
    const selfParent = await request(app)
      .patch(`/api/hr/departments/${a.body.department.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ parentDepartmentId: a.body.department.id });
    expect(selfParent.status).toBe(400);
  });

  test("un code de département dupliqué est refusé, idempotence sur la création", async () => {
    const org = await createTestOrganisation({ nom: "HR Departments E2E Duplicate" });
    mockState.organisationId = org.id;

    const first = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "FIN", name: "Finance", idempotencyKey: "dept-dup-0001" });
    expect(first.status).toBe(201);

    const duplicateCode = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "FIN", name: "Finance (bis)", idempotencyKey: "dept-dup-0002" });
    expect(duplicateCode.status).toBe(409);

    const replay = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "FIN", name: "Finance", idempotencyKey: "dept-dup-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  test("rattachement refusé pour un département introuvable, RBAC hérité du routeur RH", async () => {
    const org = await createTestOrganisation({ nom: "HR Departments E2E Missing/RBAC" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "rbac");

    const missingDept = await request(app)
      .patch(`/api/hr/employees/${employee.id}/department`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ departmentId: 999999999 });
    expect(missingDept.status).toBe(404);

    const asEmploye = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "3")
      .send({ code: "X", name: "X", idempotencyKey: "dept-rbac-0001" });
    expect(asEmploye.status).toBe(403);
  });

  test("isolation stricte : un département d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "HR Departments E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "HR Departments E2E Org B" });

    mockState.organisationId = orgA.id;
    const dept = await request(app)
      .post("/api/hr/departments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "ISO", name: "Isolation", idempotencyKey: "dept-iso-0001" });

    mockState.organisationId = orgB.id;
    const crossOrgUpdate = await request(app)
      .patch(`/api/hr/departments/${dept.body.department.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ name: "Renommé" });
    expect(crossOrgUpdate.status).toBe(404);

    const chart = await request(app)
      .get("/api/hr/organisation-chart")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(chart.body.departments.find((d) => d.code === "ISO")).toBeUndefined();
  });
});
