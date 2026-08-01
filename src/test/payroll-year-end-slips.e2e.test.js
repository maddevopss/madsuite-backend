// Preuve d'exécution réelle du domaine 4 (paie), feuillets fiscaux de fin
// d'année (T4/RL-1/T4A/RL-2). Cartographie préalable : payroll-year-end.
// routes.js est réellement monté (/api/payroll/remittances/year-end-slips),
// et sa logique pure (buildYearEndSlip) a des tests unitaires, mais aucun
// test n'exécutait de vraie requête SQL contre ce routeur. Ce test exécute
// le cycle complet draft → validated → issued, la modification après
// émission (amend, qui crée un nouveau feuillet plutôt que de modifier
// l'original), et l'unicité par empreinte de contenu (source_hash), via de
// vraies requêtes HTTP contre une vraie base.
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
    payType: "salary",
    annualSalary: 60000,
    ...overrides,
  };
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_employees
      (organisation_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, annual_salary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [organisationId, base.employeeNumber, base.legalName, base.legalFirstName, base.legalLastName, base.hireDate, base.payType, base.annualSalary],
  );
  return rows[0];
}

describe("Feuillets fiscaux de fin d'année — cycle complet (domaine 4)", () => {
  let app;
  let orgId;
  let employeeId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Year End Slips E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();
    const employee = await seedEmployee(orgId);
    employeeId = employee.id;
  });

  test("un employé sans rôle admin/manager ne peut ni lister ni créer de feuillet", async () => {
    const list = await request(app).get("/api/payroll/remittances/year-end-slips").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "employe")
      .send({ employeeId, taxYear: 2026, slipType: "T4", earnings: 60000, tax: 9000 });
    expect(create.status).toBe(403);
  });

  test("validations : année fiscale et type de feuillet invalides rejetés", async () => {
    const badYear = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId, taxYear: 1999, slipType: "T4" });
    expect(badYear.status).toBe(400);

    const badType = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId, taxYear: 2026, slipType: "BOGUS" });
    expect(badType.status).toBe(400);
  });

  test("création réelle : boîtes et totaux jsonb correctement persistés, accepte RL-1 avec tiret", async () => {
    const res = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId, taxYear: 2026, slipType: "RL-1", earnings: 60000, tax: 9500.55, pension: 3200, insurance: 850, other: { box14: 60000 } });
    expect(res.status).toBe(201);
    expect(res.body.slip.status).toBe("draft");
    expect(res.body.slip.slip_type).toBe("RL1");
    expect(res.body.slip.boxes).toEqual({ earnings: 60000, tax: 9500.55, pension: 3200, insurance: 850, box14: 60000 });
    expect(res.body.slip.totals).toEqual(res.body.slip.boxes);

    // Un feuillet strictement identique (même empreinte de contenu) est
    // rejeté (unicité organisation/employé/année/type/source_hash).
    const duplicate = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId, taxYear: 2026, slipType: "RL-1", earnings: 60000, tax: 9500.55, pension: 3200, insurance: 850, other: { box14: 60000 } });
    expect(duplicate.status).toBe(409);
  });

  test("cycle de transition complet : validation, émission avec référence obligatoire", async () => {
    const employee2 = await seedEmployee(orgId);
    const created = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId: employee2.id, taxYear: 2026, slipType: "T4", earnings: 55000, tax: 8000 });
    const id = created.body.slip.id;

    const issueBeforeValidate = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/issue`).set("x-test-role", "admin")
      .send({ approvalReference: "APP-0001" });
    expect(issueBeforeValidate.status).toBe(409);

    const validated = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/validate`).set("x-test-role", "admin");
    expect(validated.status).toBe(200);
    expect(validated.body.slip.status).toBe("validated");

    const issueWithoutReference = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/issue`).set("x-test-role", "admin").send({});
    expect(issueWithoutReference.status).toBe(400);

    const issued = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/issue`).set("x-test-role", "admin")
      .send({ approvalReference: "APP-0001" });
    expect(issued.status).toBe(200);
    expect(issued.body.slip.status).toBe("issued");
    expect(issued.body.slip.issued_at).toBeTruthy();
  });

  test("modification après émission (amend) : crée un nouveau feuillet, marque l'original 'amended'", async () => {
    const employee3 = await seedEmployee(orgId);
    const created = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId: employee3.id, taxYear: 2026, slipType: "T4", earnings: 50000, tax: 7000 });
    const originalId = created.body.slip.id;
    await request(app).post(`/api/payroll/remittances/year-end-slips/${originalId}/validate`).set("x-test-role", "admin");
    await request(app).post(`/api/payroll/remittances/year-end-slips/${originalId}/issue`).set("x-test-role", "admin").send({ approvalReference: "APP-0002" });

    const amended = await request(app).post(`/api/payroll/remittances/year-end-slips/${originalId}/amend`).set("x-test-role", "admin")
      .send({ earnings: 51500, tax: 7250 });
    expect(amended.status).toBe(201);
    expect(amended.body.slip.amended_from_id).toBe(String(originalId));
    expect(amended.body.slip.status).toBe("draft");
    expect(amended.body.slip.boxes.earnings).toBe(51500);

    const original = await db.pool.query("SELECT status FROM payroll_year_end_slips WHERE id=$1", [originalId]);
    expect(original.rows[0].status).toBe("amended");
  });

  test("annulation possible depuis draft/validated, action inconnue rejetée, feuillet introuvable en 404", async () => {
    const employee4 = await seedEmployee(orgId);
    const created = await request(app).post("/api/payroll/remittances/year-end-slips").set("x-test-role", "manager")
      .send({ employeeId: employee4.id, taxYear: 2026, slipType: "T4A", earnings: 12000, tax: 1500 });
    const id = created.body.slip.id;

    const unknownAction = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const cancelled = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/cancel`).set("x-test-role", "admin");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.slip.status).toBe("cancelled");

    const validateAfterCancel = await request(app).post(`/api/payroll/remittances/year-end-slips/${id}/validate`).set("x-test-role", "admin");
    expect(validateAfterCancel.status).toBe(409);

    const notFound = await request(app).post(`/api/payroll/remittances/year-end-slips/999999/validate`).set("x-test-role", "admin");
    expect(notFound.status).toBe(404);
  });

  test("filtre par employé et par année fiscale", async () => {
    const byEmployee = await request(app).get("/api/payroll/remittances/year-end-slips").query({ employeeId }).set("x-test-role", "admin");
    expect(byEmployee.status).toBe(200);
    expect(byEmployee.body.slips.every((slip) => slip.employee_id === String(employeeId))).toBe(true);

    const byYear = await request(app).get("/api/payroll/remittances/year-end-slips").query({ taxYear: 2026 }).set("x-test-role", "admin");
    expect(byYear.status).toBe(200);
    expect(byYear.body.slips.every((slip) => slip.tax_year === 2026)).toBe(true);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Year End Slips E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/payroll/remittances/year-end-slips").set("x-test-role", "admin");
      expect(list.body.slips).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
