// Étage 8 PR C — Problèmes et causes profondes (issue #194).
// Suite de la PR B (incidents opérationnels). Ce test exécute par de
// vraies requêtes HTTP contre une vraie base : création liée à des
// incidents réels, cycle analyse de cause → action corrective →
// vérification → fermeture, récidive qui rouvre automatiquement un
// problème "résolu", fermeture en erreur connue (registre), RBAC et
// isolation multi-organisation.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

const mockState = { organisationId: null, userId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: mockState.userId, role };
  next();
}

const operationalIncidentsRoutes = require("../routes/business/operational-incidents.routes");
const operationalProblemsRoutes = require("../routes/business/operational-problems.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/incidents", operationalIncidentsRoutes);
  app.use("/api/operations/problems", operationalProblemsRoutes);
  return app;
}

async function declareIncident(app, overrides = {}) {
  const res = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
    .send({
      title: "Incident lié",
      description: "Test",
      severity: "high",
      impactSummary: "Impact",
      serviceKey: "svc-problems-e2e",
      idempotencyKey: `inc-for-problem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...overrides,
    });
  return res.body.incident;
}

describe("Problèmes et causes profondes — cycle complet (Étage 8 PR C)", () => {
  let app;
  let orgId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Operational Problems E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    app = buildApp();
  });

  test("un employé ne peut ni lister ni créer de problème", async () => {
    const list = await request(app).get("/api/operations/problems").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/operations/problems").set("x-test-role", "employe")
      .send({ title: "X", description: "X" });
    expect(create.status).toBe(403);
  });

  test("validations : champs obligatoires, incident lié introuvable rejeté", async () => {
    const missingFields = await request(app).post("/api/operations/problems").set("x-test-role", "manager").send({});
    expect(missingFields.status).toBe(400);

    const badIncident = await request(app).post("/api/operations/problems").set("x-test-role", "manager")
      .send({ title: "Problème", description: "Test", linkedIncidentIds: [999999999] });
    expect(badIncident.status).toBe(404);
  });

  test("création liée à un incident réel : classification récurrente dès la création", async () => {
    const incident = await declareIncident(app);
    const res = await request(app).post("/api/operations/problems").set("x-test-role", "manager")
      .send({
        title: "Fuite de connexions DB récurrente",
        description: "Plusieurs incidents de latence liés à la même cause",
        linkedIncidentIds: [incident.id],
        idempotencyKey: "prob-e2e-0001",
      });
    expect(res.status).toBe(201);
    expect(res.body.problem.status).toBe("open");
    expect(res.body.problem.recurrence_count).toBe(1);
    expect(res.body.problem.linked_incident_ids.map(Number)).toEqual([Number(incident.id)]);
  });

  test("cycle complet : analyse de cause → action corrective → vérification effective → fermeture 'resolved'", async () => {
    const created = await request(app).post("/api/operations/problems").set("x-test-role", "manager")
      .send({ title: "Problème cycle complet", description: "Test", idempotencyKey: "prob-e2e-cycle-0001" });
    const id = created.body.problem.id;

    const remediateBeforeAnalyze = await request(app).post(`/api/operations/problems/${id}/remediate`).set("x-test-role", "admin")
      .send({ correctiveAction: "Trop tôt" });
    expect(remediateBeforeAnalyze.status).toBe(409);

    const analyzeWithoutCause = await request(app).post(`/api/operations/problems/${id}/analyze`).set("x-test-role", "admin").send({});
    expect(analyzeWithoutCause.status).toBe(400);

    const analyzed = await request(app).post(`/api/operations/problems/${id}/analyze`).set("x-test-role", "admin")
      .send({ rootCause: "Pool de connexions DB sous-dimensionné" });
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.problem.status).toBe("root_cause_identified");

    const remediated = await request(app).post(`/api/operations/problems/${id}/remediate`).set("x-test-role", "admin")
      .send({ correctiveAction: "Augmenter la taille du pool de connexions", dueAt: "2026-09-01" });
    expect(remediated.status).toBe(200);
    expect(remediated.body.problem.status).toBe("corrective_action_in_progress");

    const verifyIneffective = await request(app).post(`/api/operations/problems/${id}/verify`).set("x-test-role", "admin")
      .send({ outcome: "ineffective", verificationEvidence: "Récidive observée après 24h" });
    expect(verifyIneffective.status).toBe(200);
    expect(verifyIneffective.body.problem.status).toBe("corrective_action_in_progress"); // retour en arrière, pas de récidive perdue

    const closeTooEarly = await request(app).post(`/api/operations/problems/${id}/close`).set("x-test-role", "admin")
      .send({ closureType: "resolved" });
    expect(closeTooEarly.status).toBe(409);

    const verifyEffective = await request(app).post(`/api/operations/problems/${id}/verify`).set("x-test-role", "admin")
      .send({ outcome: "effective", verificationEvidence: "48h sans récidive après augmentation du pool" });
    expect(verifyEffective.status).toBe(200);
    expect(verifyEffective.body.problem.status).toBe("resolved");

    const closed = await request(app).post(`/api/operations/problems/${id}/close`).set("x-test-role", "admin")
      .send({ closureType: "resolved" });
    expect(closed.status).toBe(200);
    expect(closed.body.problem.status).toBe("closed");
    expect(closed.body.problem.closure_type).toBe("resolved");
  });

  test("une récidive sur un problème 'closed/resolved' le rouvre automatiquement", async () => {
    const created = await request(app).post("/api/operations/problems").set("x-test-role", "manager")
      .send({ title: "Problème réouverture", description: "Test", idempotencyKey: "prob-e2e-reopen-0001" });
    const id = created.body.problem.id;
    await request(app).post(`/api/operations/problems/${id}/analyze`).set("x-test-role", "admin").send({ rootCause: "Cause X" });
    await request(app).post(`/api/operations/problems/${id}/remediate`).set("x-test-role", "admin").send({ correctiveAction: "Correctif X" });
    await request(app).post(`/api/operations/problems/${id}/verify`).set("x-test-role", "admin")
      .send({ outcome: "effective", verificationEvidence: "Semble réglé" });
    await request(app).post(`/api/operations/problems/${id}/close`).set("x-test-role", "admin").send({ closureType: "resolved" });

    const newIncident = await declareIncident(app);
    const linked = await request(app).post(`/api/operations/problems/${id}/link-incident`).set("x-test-role", "admin")
      .send({ incidentId: newIncident.id });
    expect(linked.status).toBe(200);
    expect(linked.body.reopened).toBe(true);
    expect(linked.body.problem.status).toBe("open");
    expect(linked.body.problem.recurrence_count).toBe(1);

    // Relier deux fois le même incident ne compte pas une deuxième récidive.
    const duplicateLink = await request(app).post(`/api/operations/problems/${id}/link-incident`).set("x-test-role", "admin")
      .send({ incidentId: newIncident.id });
    expect(duplicateLink.status).toBe(200);
    expect(duplicateLink.body.duplicate).toBe(true);
    expect(duplicateLink.body.problem.recurrence_count).toBe(1);
  });

  test("fermeture en erreur connue exige un contournement, apparaît dans le registre", async () => {
    const created = await request(app).post("/api/operations/problems").set("x-test-role", "manager")
      .send({ title: "Erreur connue", description: "Cause matérielle non éliminable à court terme", idempotencyKey: "prob-e2e-ke-0001" });
    const id = created.body.problem.id;
    await request(app).post(`/api/operations/problems/${id}/analyze`).set("x-test-role", "admin").send({ rootCause: "Défaut firmware fournisseur" });
    await request(app).post(`/api/operations/problems/${id}/remediate`).set("x-test-role", "admin").send({ correctiveAction: "Mise à jour firmware en attente du fournisseur" });

    const closeWithoutWorkaround = await request(app).post(`/api/operations/problems/${id}/close`).set("x-test-role", "admin")
      .send({ closureType: "known_error" });
    expect(closeWithoutWorkaround.status).toBe(400);

    const closed = await request(app).post(`/api/operations/problems/${id}/close`).set("x-test-role", "admin")
      .send({ closureType: "known_error", workaround: "Redémarrer le service toutes les 12h en attendant le correctif fournisseur" });
    expect(closed.status).toBe(200);
    expect(closed.body.problem.closure_type).toBe("known_error");

    const registry = await request(app).get("/api/operations/problems/known-errors").set("x-test-role", "admin");
    expect(registry.status).toBe(200);
    expect(registry.body.knownErrors.some((p) => p.id === id)).toBe(true);
  });

  test("action inconnue et problème introuvable renvoient une erreur explicite", async () => {
    const created = await request(app).post("/api/operations/problems").set("x-test-role", "manager")
      .send({ title: "Test action inconnue", description: "Test", idempotencyKey: "prob-e2e-unknown-0001" });
    const id = created.body.problem.id;

    const unknownAction = await request(app).post(`/api/operations/problems/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const notFound = await request(app).post("/api/operations/problems/999999999/analyze").set("x-test-role", "admin").send({ rootCause: "X" });
    expect(notFound.status).toBe(404);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Operational Problems E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/operations/problems").set("x-test-role", "admin");
      expect(list.body.problems).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
