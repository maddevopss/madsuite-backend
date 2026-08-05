// Suite du chantier RH/SST (2026-08-02) : hr-complete-block.service.js
// (assessOffboardingReadiness) et la table hr_offboarding_cases
// existaient (migration du 27/07) sans jamais être montés sur aucune
// route (grep exhaustif avant d'écrire ce fichier). Correspond à la
// section 1.B du mandat RH : checklist de départ (révocation des accès,
// restitution d'équipements, sortie de paie). Ce test exécute par de
// vraies requêtes HTTP contre une vraie base : ouverture, mise à jour
// idempotente de la checklist, garde-fou de fermeture (les 4
// confirmations requises), immutabilité après fermeture, annulation,
// idempotence de l'ouverture, RBAC hérité et isolation multi-organisation.
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
    [organisationId, `E-OFFBOARD-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Dossiers de départ RH (suite du 2026-08-02)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("cycle de vie complet : ouverture -> progression -> fermeture gardée -> immutabilité", async () => {
    const org = await createTestOrganisation({ nom: "HR Offboarding E2E Lifecycle" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    const employee = await seedEmployee(org.id, "lifecycle");

    const opened = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ employeeId: employee.id, effectiveDate: "2026-09-01", reasonCode: "resignation", idempotencyKey: "offboard-open-0001" });
    expect(opened.status).toBe(201);
    expect(opened.body.offboardingCase.status).toBe("open");
    const caseId = opened.body.offboardingCase.id;

    // Fermeture refusée tant qu'aucune confirmation n'est faite.
    const closeTooEarly = await request(app)
      .post(`/api/hr/offboarding-cases/${caseId}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "offboard-close-0001" });
    expect(closeTooEarly.status).toBe(409);

    const partialUpdate = await request(app)
      .patch(`/api/hr/offboarding-cases/${caseId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ payrollConfirmed: true, accessRevoked: true });
    expect(partialUpdate.status).toBe(200);
    expect(partialUpdate.body.offboardingCase.status).toBe("in_progress");
    expect(partialUpdate.body.offboardingCase.payroll_confirmed).toBe(true);
    expect(partialUpdate.body.offboardingCase.property_returned).toBe(false);

    const stillBlocked = await request(app)
      .post(`/api/hr/offboarding-cases/${caseId}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "offboard-close-0002" });
    expect(stillBlocked.status).toBe(409);

    await request(app)
      .patch(`/api/hr/offboarding-cases/${caseId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ propertyReturned: true, documentsCompleted: true });

    const closed = await request(app)
      .post(`/api/hr/offboarding-cases/${caseId}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "offboard-close-0003" });
    expect(closed.status).toBe(200);
    expect(closed.body.offboardingCase.status).toBe("completed");
    expect(closed.body.offboardingCase.completed_at).toBeTruthy();

    // Un dossier fermé est immuable.
    const patchAfterClose = await request(app)
      .patch(`/api/hr/offboarding-cases/${caseId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ payrollConfirmed: false });
    expect(patchAfterClose.status).toBe(409);
  });

  test("un dossier dupliqué (même employé, même date d’effet) est refusé", async () => {
    const org = await createTestOrganisation({ nom: "HR Offboarding E2E Duplicate" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    const employee = await seedEmployee(org.id, "duplicate");

    const first = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ employeeId: employee.id, effectiveDate: "2026-10-01", reasonCode: "layoff", idempotencyKey: "offboard-dup-0001" });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ employeeId: employee.id, effectiveDate: "2026-10-01", reasonCode: "layoff", idempotencyKey: "offboard-dup-0002" });
    expect(duplicate.status).toBe(409);

    // Rejouer la même clé d'idempotence retourne le dossier existant.
    const replay = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ employeeId: employee.id, effectiveDate: "2026-10-01", reasonCode: "layoff", idempotencyKey: "offboard-dup-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  test("annulation : raison obligatoire, refusée sur un dossier déjà fermé", async () => {
    const org = await createTestOrganisation({ nom: "HR Offboarding E2E Cancel" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    const employee = await seedEmployee(org.id, "cancel");

    const opened = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ employeeId: employee.id, effectiveDate: "2026-11-01", reasonCode: "resignation", idempotencyKey: "offboard-cancel-0001" });
    const caseId = opened.body.offboardingCase.id;

    const missingReason = await request(app)
      .post(`/api/hr/offboarding-cases/${caseId}/cancel`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "offboard-cancel-0002" });
    expect(missingReason.status).toBe(400);

    const cancelled = await request(app)
      .post(`/api/hr/offboarding-cases/${caseId}/cancel`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ reason: "L’employé a retiré sa démission", idempotencyKey: "offboard-cancel-0003" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.offboardingCase.status).toBe("cancelled");

    const cancelAgain = await request(app)
      .post(`/api/hr/offboarding-cases/${caseId}/cancel`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ reason: "Test", idempotencyKey: "offboard-cancel-0004" });
    expect(cancelAgain.status).toBe(409);
  });

  test("ouverture refusée pour un employé introuvable, RBAC hérité du routeur RH", async () => {
    const org = await createTestOrganisation({ nom: "HR Offboarding E2E Missing/RBAC" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });

    const missingEmployee = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ employeeId: 999999999, effectiveDate: "2026-09-01", reasonCode: "resignation", idempotencyKey: "offboard-missing-0001" });
    expect(missingEmployee.status).toBe(404);

    const employee = await seedEmployee(org.id, "rbac");
    const asEmploye = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "3")
      .send({ employeeId: employee.id, effectiveDate: "2026-09-01", reasonCode: "resignation", idempotencyKey: "offboard-rbac-0001" });
    expect(asEmploye.status).toBe(403);
  });

  test("isolation stricte : un dossier de départ d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "HR Offboarding E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "HR Offboarding E2E Org B" });

    mockState.organisationId = orgA.id;
    const userA = await createTestUser({ organisation_id: orgA.id, role: "admin" });
    const employeeA = await seedEmployee(orgA.id, "iso-a");
    const opened = await request(app)
      .post("/api/hr/offboarding-cases")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(userA.id))
      .send({ employeeId: employeeA.id, effectiveDate: "2026-09-01", reasonCode: "resignation", idempotencyKey: "offboard-iso-0001" });

    mockState.organisationId = orgB.id;
    const userB = await createTestUser({ organisation_id: orgB.id, role: "admin" });
    const crossOrgGet = await request(app)
      .get(`/api/hr/offboarding-cases/${opened.body.offboardingCase.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(userB.id));
    expect(crossOrgGet.status).toBe(404);

    const crossOrgClose = await request(app)
      .post(`/api/hr/offboarding-cases/${opened.body.offboardingCase.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(userB.id))
      .send({ idempotencyKey: "offboard-iso-0002" });
    expect(crossOrgClose.status).toBe(404);
  });
});
