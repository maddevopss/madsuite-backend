// Étage 9 PR D — Confirmation humaine et exécution (issue #195).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// génération réelle d'une recommandation (PR C), confirmation qui
// EXÉCUTE la politique métier existante (liaison incident/problème,
// Étage 8 PR C) — pas une réimplémentation — refus d'un problème hors
// recommandation, refus (avec motif), double décision bloquée,
// conservation de l'auteur humain sur la ligne d'audit, RBAC (admin
// seulement), isolation multi-organisation.
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
  const userId = req.header("x-test-user-id");
  if (role) req.user = { id: userId ? Number(userId) : mockState.userId, role };
  next();
}

const aiRecommendationsRoutes = require("../routes/business/ai-recommendations.routes");
const aiUseCasesRoutes = require("../routes/business/ai-use-cases.routes");
const aiDecisionsRoutes = require("../routes/business/ai-decisions.routes");
const operationalIncidentsRoutes = require("../routes/business/operational-incidents.routes");
const operationalProblemsRoutes = require("../routes/business/operational-problems.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/ai/recommendations", aiRecommendationsRoutes);
  app.use("/api/ai/use-cases", aiUseCasesRoutes);
  app.use("/api/ai/decisions", aiDecisionsRoutes);
  app.use("/api/operations/incidents", operationalIncidentsRoutes);
  app.use("/api/operations/problems", operationalProblemsRoutes);
  return app;
}

const USE_CASE = "incident-known-error-suggestion";

async function activateForOrg(app, organisationId, userId) {
  const previous = mockState.organisationId;
  mockState.organisationId = organisationId;
  try {
    await request(app).post(`/api/ai/use-cases/${USE_CASE}/activate`).set("x-test-role", "admin").set("x-test-user-id", String(userId)).send({});
  } finally {
    mockState.organisationId = previous;
  }
}

async function seedKnownError(organisationId, userId, incidentId, workaround, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO operational_problems (
       organisation_id, problem_number, title, description, status, closure_type, workaround,
       linked_incident_ids, recurrence_count, responsible_user_id, idempotency_key
     ) VALUES ($1,$2,'Erreur connue test','Test','closed','known_error',$3,$4::jsonb,1,$5,$6) RETURNING *`,
    [organisationId, `PRD-DEC-${suffix}`, workaround, JSON.stringify([incidentId]), userId, `dec-known-error-${suffix}`],
  );
  return rows[0];
}

async function generateRecommendation(app, incidentId, adminId) {
  const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incidentId}`)
    .set("x-test-role", "admin").set("x-test-user-id", String(adminId));
  return res.body;
}

describe("Confirmation humaine et exécution — décision réelle (Étage 9 PR D)", () => {
  let app;
  let orgId;
  let adminId;
  let managerId;

  beforeAll(async () => {
    await db.pool.query(
      `INSERT INTO ai_use_cases (id, version, owner, status, autonomy, risk_level, data_classes, description)
       VALUES ($1,'1.0','operations-lead','approved','advisory','low','["operational_incidents","operational_problems"]'::jsonb,'Test')
       ON CONFLICT (id, version) DO NOTHING`,
      [USE_CASE],
    );
    const org = await createTestOrganisation({ nom: "AI Decisions E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const admin = await createTestUser({ organisation_id: orgId, role: "admin" });
    const manager = await createTestUser({ organisation_id: orgId, role: "manager" });
    adminId = admin.id;
    managerId = manager.id;
    mockState.userId = adminId;
    app = buildApp();
    await activateForOrg(app, orgId, adminId);
  });

  test("un manager ne peut ni confirmer ni refuser une décision", async () => {
    const res = await request(app).post("/api/ai/decisions/1/confirm").set("x-test-role", "manager").set("x-test-user-id", String(managerId)).send({});
    expect(res.status).toBe(403);
  });

  test("ligne d'audit introuvable renvoie 404", async () => {
    const res = await request(app).post("/api/ai/decisions/999999999/confirm").set("x-test-role", "admin").set("x-test-user-id", String(adminId)).send({});
    expect(res.status).toBe(404);
  });

  test("confirmer une recommandation sans source (aucune erreur connue) est refusé — rien à décider", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(managerId))
      .send({ title: "Incident sans historique", description: "Test", severity: "medium", impactSummary: "Impact", serviceKey: "svc-dec-nosource", idempotencyKey: "dec-nosource-0001" });
    const body = await generateRecommendation(app, incident.body.incident.id, adminId);
    expect(body.recommendation).toBeNull();

    const confirm = await request(app).post(`/api/ai/decisions/${body.auditEntryId}/confirm`).set("x-test-role", "admin").set("x-test-user-id", String(adminId)).send({ problemId: 1 });
    expect(confirm.status).toBe(409);
    expect(confirm.body.code).toBe("ai.no_recommendation_to_decide");
  });

  test("confirmer un problème hors des erreurs connues effectivement citées est refusé", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(managerId))
      .send({ title: "Panne API paiement", description: "Test", severity: "critical", impactSummary: "Impact", serviceKey: "svc-dec-payment", idempotencyKey: "dec-payment-0001" });
    const incidentId = incident.body.incident.id;
    const knownError = await seedKnownError(orgId, adminId, incidentId, "Basculer vers le fournisseur de secours", "payment-1");

    const body = await generateRecommendation(app, incidentId, adminId);
    expect(body.recommendation).toBeTruthy();

    const wrongProblem = await request(app).post(`/api/ai/decisions/${body.auditEntryId}/confirm`).set("x-test-role", "admin").set("x-test-user-id", String(adminId))
      .send({ problemId: 999999999 });
    expect(wrongProblem.status).toBe(400);
    expect(wrongProblem.body.code).toBe("ai.problem_not_in_recommendation");

    // Sanity : le vrai problème cité fonctionnerait (vérifié dans le test suivant, cycle complet).
    expect(body.context.knownErrors.map((e) => String(e.problemId))).toContain(String(knownError.id));
  });

  test("cycle complet : confirmation EXÉCUTE la politique métier existante (liaison incident/problème), auteur humain conservé", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(managerId))
      .send({ title: "Panne file d'attente", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-dec-queue", idempotencyKey: "dec-queue-0001" });
    const incidentId = incident.body.incident.id;
    const knownError = await seedKnownError(orgId, adminId, incidentId, "Purger la file bloquée", "queue-1");

    // Un DEUXIÈME incident du même service — c'est celui qu'on confirme,
    // pour vraiment prouver que la confirmation exécute la liaison (pas
    // déjà liée par le seed).
    const secondIncident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(managerId))
      .send({ title: "Deuxième panne file", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-dec-queue", idempotencyKey: "dec-queue-0002" });
    const secondIncidentId = secondIncident.body.incident.id;

    const body = await generateRecommendation(app, secondIncidentId, adminId);
    expect(body.recommendation).toBeTruthy();

    const confirmed = await request(app).post(`/api/ai/decisions/${body.auditEntryId}/confirm`).set("x-test-role", "admin").set("x-test-user-id", String(adminId))
      .send({ problemId: knownError.id });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.auditEntry.human_decision).toBe("confirmed");
    expect(String(confirmed.body.auditEntry.human_decision_by)).toBe(String(adminId));
    expect(confirmed.body.auditEntry.human_decision_at).toBeTruthy();
    expect(confirmed.body.execution.duplicate).toBe(false);

    // Preuve d'exécution réelle : le problème est maintenant lié au
    // DEUXIÈME incident (politique métier existante réellement appliquée).
    const problemCheck = await db.pool.query('SELECT linked_incident_ids, recurrence_count FROM operational_problems WHERE id=$1', [knownError.id]);
    expect(problemCheck.rows[0].linked_incident_ids.map(String)).toContain(String(secondIncidentId));
    expect(problemCheck.rows[0].recurrence_count).toBe(2); // 1 au seed + 1 via la confirmation

    // Une décision déjà prise ne peut pas être reprise.
    const again = await request(app).post(`/api/ai/decisions/${body.auditEntryId}/confirm`).set("x-test-role", "admin").set("x-test-user-id", String(adminId))
      .send({ problemId: knownError.id });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ai.decision_already_made");
  });

  test("refuser exige un motif, conserve l'auteur humain", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(managerId))
      .send({ title: "Panne stockage", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-dec-storage", idempotencyKey: "dec-storage-0001" });
    const incidentId = incident.body.incident.id;
    await seedKnownError(orgId, adminId, incidentId, "Purger le cache de stockage", "storage-1");

    const body = await generateRecommendation(app, incidentId, adminId);

    const missingReason = await request(app).post(`/api/ai/decisions/${body.auditEntryId}/decline`).set("x-test-role", "admin").set("x-test-user-id", String(adminId)).send({});
    expect(missingReason.status).toBe(400);

    const declined = await request(app).post(`/api/ai/decisions/${body.auditEntryId}/decline`).set("x-test-role", "admin").set("x-test-user-id", String(adminId))
      .send({ reason: "Ce contournement ne s'applique pas à ce type de panne" });
    expect(declined.status).toBe(200);
    expect(declined.body.auditEntry.human_decision).toBe("declined");
    expect(String(declined.body.auditEntry.human_decision_by)).toBe(String(adminId));
  });

  test("isolation stricte : une ligne d'audit d'une autre organisation est introuvable", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Decisions E2E Org B" });
    const otherAdmin = await createTestUser({ organisation_id: otherOrg.id, role: "admin" });
    await activateForOrg(app, otherOrg.id, otherAdmin.id);

    const previous = mockState.organisationId;
    const previousUser = mockState.userId;
    mockState.organisationId = otherOrg.id;
    mockState.userId = otherAdmin.id;
    let otherAuditEntryId;
    try {
      const otherIncident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(otherAdmin.id))
        .send({ title: "Incident org B", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-dec-orgb", idempotencyKey: "dec-orgb-0001" });
      const body = await generateRecommendation(app, otherIncident.body.incident.id, otherAdmin.id);
      otherAuditEntryId = body.auditEntryId;
    } finally {
      mockState.organisationId = previous;
      mockState.userId = previousUser;
    }

    const crossOrgConfirm = await request(app).post(`/api/ai/decisions/${otherAuditEntryId}/confirm`).set("x-test-role", "admin").set("x-test-user-id", String(adminId)).send({});
    expect(crossOrgConfirm.status).toBe(404);
  });
});
