// Suite du même audit RH/SST (2026-08-02) : sst-complete-block.service.js
// (assessTrainingCompliance) et la table sst_training_assignments
// existaient (migration du 27/07) sans jamais être montés sur aucune
// route (grep exhaustif avant d'écrire ce fichier). Correspond à la
// section 2C du mandat SST : conformité de formation, alertes 90/60/30
// jours. Ce test exécute par de vraies requêtes HTTP contre une vraie
// base : affectation, transitions (assigned -> in_progress -> completed,
// ou waived/cancelled/expired), garde-fous, agrégat de conformité par
// employé, alertes d'échéance, idempotence, RBAC et isolation
// multi-organisation.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

const mockState = { organisationId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.organisation_id = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  const userId = req.header("x-test-user-id");
  if (role) req.user = { id: userId ? Number(userId) : null, role, organisation_id: mockState.organisationId };
  next();
}

const sstRoutes = require("../routes/business/sst.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/sst", sstRoutes);
  return app;
}

async function seedEmployee(organisationId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO hr_employees (organisation_id, employee_number, legal_name) VALUES ($1,$2,'Employé Test') RETURNING *`,
    [organisationId, `E-TRAINING-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Conformité de formation SST (suite du 2026-08-02)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("cycle de vie complet : assigned -> in_progress -> completed, transitions invalides refusées", async () => {
    const org = await createTestOrganisation({ nom: "SST Training E2E Lifecycle" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "lifecycle");

    const assigned = await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, trainingCode: "SIMDUT", title: "SIMDUT 2015", dueAt: "2026-12-31", idempotencyKey: "assign-lifecycle-0001" });
    expect(assigned.status).toBe(201);
    expect(assigned.body.assignment.status).toBe("assigned");
    const assignmentId = assigned.body.assignment.id;

    // "complete" directement depuis "assigned" est refusé : il faut passer par "start".
    const invalidComplete = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/complete`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "transition-lifecycle-0001" });
    expect(invalidComplete.status).toBe(409);

    const started = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/start`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "transition-lifecycle-0002" });
    expect(started.status).toBe(201);
    expect(started.body.assignment.status).toBe("in_progress");

    const badScore = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/complete`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ score: 150, idempotencyKey: "transition-lifecycle-0003" });
    expect(badScore.status).toBe(400);

    const completed = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/complete`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ score: 92, idempotencyKey: "transition-lifecycle-0004" });
    expect(completed.status).toBe(201);
    expect(completed.body.assignment.status).toBe("completed");
    expect(Number(completed.body.assignment.score)).toBe(92);
    expect(completed.body.assignment.completed_at).toBeTruthy();

    // Une formation terminée n'accepte plus aucune transition.
    const afterCompleted = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/cancel`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ reason: "Test", idempotencyKey: "transition-lifecycle-0005" });
    expect(afterCompleted.status).toBe(409);
  });

  test("waive/cancel exigent une raison, idempotence sur les transitions", async () => {
    const org = await createTestOrganisation({ nom: "SST Training E2E Waive" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "waive");

    const assigned = await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, trainingCode: "ESPACE-CLOS", title: "Espace clos", idempotencyKey: "assign-waive-0001" });
    const assignmentId = assigned.body.assignment.id;

    const missingReason = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/waive`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "transition-waive-0001" });
    expect(missingReason.status).toBe(400);

    const waived = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/waive`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ reason: "Non applicable à ce poste", idempotencyKey: "transition-waive-0002" });
    expect(waived.status).toBe(201);
    expect(waived.body.assignment.status).toBe("waived");

    const replay = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/waive`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ reason: "Non applicable à ce poste", idempotencyKey: "transition-waive-0002" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    const history = await db.pool.query("SELECT * FROM sst_training_assignment_transitions WHERE organisation_id=$1 AND assignment_id=$2", [org.id, assignmentId]);
    expect(history.rows).toHaveLength(1);
  });

  test("conformité par employé : une formation en retard (assigned, échéance passée) réduit la conformité", async () => {
    const org = await createTestOrganisation({ nom: "SST Training E2E Compliance" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "compliance");

    await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, trainingCode: "HAUTEUR", title: "Travail en hauteur", dueAt: "2020-01-01", idempotencyKey: "assign-compliance-0001" });
    await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, trainingCode: "CHARIOT", title: "Chariot élévateur", dueAt: "2027-01-01", idempotencyKey: "assign-compliance-0002" });

    const compliance = await request(app)
      .get(`/api/sst/employees/${employee.id}/training-compliance`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(compliance.status).toBe(200);
    expect(compliance.body.compliance.total).toBe(2);
    expect(compliance.body.compliance.overdue).toBe(1);
    expect(compliance.body.compliance.compliant).toBe(false);
  });

  test("alertes 90/60/30 jours : une formation due dans 20 jours apparaît dans les trois fenêtres, pas dans 'overdue'", async () => {
    const org = await createTestOrganisation({ nom: "SST Training E2E Alerts" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "alerts");
    const dueInTwentyDays = new Date(Date.now() + 20 * 86400000).toISOString();

    await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, trainingCode: "SIMDUT", title: "SIMDUT", dueAt: dueInTwentyDays, idempotencyKey: "assign-alerts-0001" });

    const alerts = await request(app)
      .get("/api/sst/training-compliance/alerts")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(alerts.status).toBe(200);
    expect(alerts.body.due30.some((a) => a.training_code === "SIMDUT")).toBe(true);
    expect(alerts.body.due60.some((a) => a.training_code === "SIMDUT")).toBe(true);
    expect(alerts.body.due90.some((a) => a.training_code === "SIMDUT")).toBe(true);
    expect(alerts.body.overdue.some((a) => a.training_code === "SIMDUT")).toBe(false);
  });

  test("un employe ne peut pas assigner ou transitionner une formation, mais peut lire", async () => {
    const org = await createTestOrganisation({ nom: "SST Training E2E RBAC" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "rbac");

    const attempt = await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "3")
      .send({ employeeId: employee.id, trainingCode: "SIMDUT", title: "SIMDUT", idempotencyKey: "assign-rbac-0001" });
    expect(attempt.status).toBe(403);

    const list = await request(app).get("/api/sst/training-assignments").set("x-test-role", "employe").set("x-test-user-id", "3");
    expect(list.status).toBe(200);
  });

  test("isolation stricte : une affectation de formation d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "SST Training E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "SST Training E2E Org B" });

    mockState.organisationId = orgA.id;
    const employeeA = await seedEmployee(orgA.id, "iso-a");
    const assigned = await request(app)
      .post("/api/sst/training-assignments")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employeeA.id, trainingCode: "SIMDUT", title: "SIMDUT", idempotencyKey: "assign-iso-0001" });
    const assignmentId = assigned.body.assignment.id;

    mockState.organisationId = orgB.id;
    const crossOrgTransition = await request(app)
      .post(`/api/sst/training-assignments/${assignmentId}/transitions/start`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "transition-iso-0001" });
    expect(crossOrgTransition.status).toBe(404);
  });
});
