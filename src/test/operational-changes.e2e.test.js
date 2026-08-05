// Étage 8 PR D — Changements et fenêtres d'entretien (issue #194).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// demande, approbation indépendante (refus si l'approbateur est le
// demandeur, refus si non-admin sur risque élevé/critique), planification
// (calendrier), exécution avec preuve obligatoire, retour arrière, rejet
// et annulation, RBAC et isolation multi-organisation.
const express = require("express");
const request = require("supertest");
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

const operationalChangesRoutes = require("../routes/business/operational-changes.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/changes", operationalChangesRoutes);
  return app;
}

describe("Changements et fenêtres d'entretien — cycle complet (Étage 8 PR D)", () => {
  let app;
  let orgId;
  let requester;
  let approver;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Operational Changes E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    requester = await createTestUser({ organisation_id: orgId, role: "manager" });
    approver = await createTestUser({ organisation_id: orgId, role: "admin" });
    app = buildApp();
  });

  test("un employé ne peut ni lister ni demander de changement", async () => {
    const list = await request(app).get("/api/operations/changes").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/operations/changes").set("x-test-role", "employe")
      .send({ title: "X", description: "X", riskLevel: "low", rollbackPlan: "X" });
    expect(create.status).toBe(403);
  });

  test("validations : champs obligatoires et niveau de risque invalide rejetés", async () => {
    const missingFields = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id)).send({});
    expect(missingFields.status).toBe(400);

    const badRisk = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "X", description: "X", riskLevel: "BOGUS", rollbackPlan: "X" });
    expect(badRisk.status).toBe(400);

    const missingRollback = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "X", description: "X", riskLevel: "low" });
    expect(missingRollback.status).toBe(400);
  });

  test("approbation indépendante : le demandeur ne peut pas approuver son propre changement", async () => {
    const created = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "Mise à jour mineure", description: "Test", riskLevel: "low", rollbackPlan: "Revert du déploiement", idempotencyKey: "chg-e2e-selfapprove-0001" });
    const id = created.body.change.id;

    const selfApprove = await request(app).post(`/api/operations/changes/${id}/approve`).set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id));
    expect(selfApprove.status).toBe(409);

    const approved = await request(app).post(`/api/operations/changes/${id}/approve`).set("x-test-role", "admin")
      .set("x-test-user-id", String(approver.id));
    expect(approved.status).toBe(200);
    expect(approved.body.change.status).toBe("approved");
  });

  test("un changement à risque élevé exige un approbateur admin, pas manager", async () => {
    const otherManager = await createTestUser({ organisation_id: orgId, role: "manager" });
    const created = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "Migration critique", description: "Test", riskLevel: "critical", rollbackPlan: "Restauration depuis sauvegarde", idempotencyKey: "chg-e2e-highrisk-0001" });
    const id = created.body.change.id;

    const managerApprove = await request(app).post(`/api/operations/changes/${id}/approve`).set("x-test-role", "manager")
      .set("x-test-user-id", String(otherManager.id));
    expect(managerApprove.status).toBe(403);

    const adminApprove = await request(app).post(`/api/operations/changes/${id}/approve`).set("x-test-role", "admin")
      .set("x-test-user-id", String(approver.id));
    expect(adminApprove.status).toBe(200);
  });

  test("cycle complet : planification, exécution avec preuve, apparition au calendrier", async () => {
    const created = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "Changement cycle complet", description: "Test", riskLevel: "medium", rollbackPlan: "Revert", idempotencyKey: "chg-e2e-cycle-0001" });
    const id = created.body.change.id;
    await request(app).post(`/api/operations/changes/${id}/approve`).set("x-test-role", "admin").set("x-test-user-id", String(approver.id));

    const executeBeforeSchedule = await request(app).post(`/api/operations/changes/${id}/execute`).set("x-test-role", "admin")
      .send({ executionProof: "Trop tôt" });
    expect(executeBeforeSchedule.status).toBe(409);

    const badWindow = await request(app).post(`/api/operations/changes/${id}/schedule`).set("x-test-role", "admin")
      .send({ windowStart: "2026-09-01T02:00:00Z", windowEnd: "2026-09-01T01:00:00Z" });
    expect(badWindow.status).toBe(400);

    const scheduled = await request(app).post(`/api/operations/changes/${id}/schedule`).set("x-test-role", "admin")
      .send({ windowStart: "2026-09-01T01:00:00Z", windowEnd: "2026-09-01T03:00:00Z" });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.change.status).toBe("scheduled");

    const calendar = await request(app).get("/api/operations/changes/calendar").set("x-test-role", "admin");
    expect(calendar.status).toBe(200);
    expect(calendar.body.calendar.some((c) => c.id === id)).toBe(true);

    const executeWithoutProof = await request(app).post(`/api/operations/changes/${id}/execute`).set("x-test-role", "admin").send({});
    expect(executeWithoutProof.status).toBe(400);

    const executed = await request(app).post(`/api/operations/changes/${id}/execute`).set("x-test-role", "admin")
      .send({ executionProof: "Déploiement confirmé, tests de fumée passés" });
    expect(executed.status).toBe(200);
    expect(executed.body.change.status).toBe("executed");
    expect(executed.body.change.executed_at).toBeTruthy();

    const rollbackWithoutReason = await request(app).post(`/api/operations/changes/${id}/rollback`).set("x-test-role", "admin").send({});
    expect(rollbackWithoutReason.status).toBe(400);

    const rolledBack = await request(app).post(`/api/operations/changes/${id}/rollback`).set("x-test-role", "admin")
      .send({ rollbackReason: "Régression détectée en production" });
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.change.status).toBe("rolled_back");

    // État terminal : toute nouvelle transition est refusée.
    const approveAfterRollback = await request(app).post(`/api/operations/changes/${id}/approve`).set("x-test-role", "admin");
    expect(approveAfterRollback.status).toBe(409);
  });

  test("rejet et annulation", async () => {
    const toReject = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "À rejeter", description: "Test", riskLevel: "low", rollbackPlan: "Revert", idempotencyKey: "chg-e2e-reject-0001" });
    const rejectWithoutReason = await request(app).post(`/api/operations/changes/${toReject.body.change.id}/reject`).set("x-test-role", "admin").send({});
    expect(rejectWithoutReason.status).toBe(400);
    const rejected = await request(app).post(`/api/operations/changes/${toReject.body.change.id}/reject`).set("x-test-role", "admin")
      .send({ reason: "Fenêtre de gel des changements" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.change.status).toBe("rejected");

    const toCancel = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "À annuler", description: "Test", riskLevel: "low", rollbackPlan: "Revert", idempotencyKey: "chg-e2e-cancel-0001" });
    const cancelled = await request(app).post(`/api/operations/changes/${toCancel.body.change.id}/cancel`).set("x-test-role", "manager")
      .send({ reason: "Plus nécessaire" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.change.status).toBe("cancelled");
  });

  test("action inconnue et changement introuvable renvoient une erreur explicite", async () => {
    const created = await request(app).post("/api/operations/changes").set("x-test-role", "manager")
      .set("x-test-user-id", String(requester.id))
      .send({ title: "Test action inconnue", description: "Test", riskLevel: "low", rollbackPlan: "Revert", idempotencyKey: "chg-e2e-unknown-0001" });
    const id = created.body.change.id;

    const unknownAction = await request(app).post(`/api/operations/changes/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const notFound = await request(app).post("/api/operations/changes/999999999/approve").set("x-test-role", "admin");
    expect(notFound.status).toBe(404);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Operational Changes E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/operations/changes").set("x-test-role", "admin");
      expect(list.body.changes).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
