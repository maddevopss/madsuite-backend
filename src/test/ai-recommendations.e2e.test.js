// Étage 9 PR C — Recommandations et explications (issue #195).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// aucune recommandation sans erreur connue (source interne) ; structure
// complète (suggestion/facts/calculations/hypotheses distincts, preuves,
// limites, confiance, expiration) quand une source existe ; confiance
// plus élevée avec plusieurs erreurs connues récentes ; garde
// d'activation héritée de la PR B ; isolation multi-organisation.
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

const aiRecommendationsRoutes = require("../routes/business/ai-recommendations.routes");
const aiUseCasesRoutes = require("../routes/business/ai-use-cases.routes");
const operationalIncidentsRoutes = require("../routes/business/operational-incidents.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/ai/recommendations", aiRecommendationsRoutes);
  app.use("/api/ai/use-cases", aiUseCasesRoutes);
  app.use("/api/operations/incidents", operationalIncidentsRoutes);
  return app;
}

const USE_CASE = "incident-known-error-suggestion";

async function seedCatalog() {
  await db.pool.query(
    `INSERT INTO ai_use_cases (id, version, owner, status, autonomy, risk_level, data_classes, description)
     VALUES ($1,'1.0','operations-lead','approved','advisory','low','["operational_incidents","operational_problems"]'::jsonb,'Test')
     ON CONFLICT (id, version) DO NOTHING`,
    [USE_CASE],
  );
}

async function activateForOrg(app, organisationId, userId) {
  const previous = mockState.organisationId;
  mockState.organisationId = organisationId;
  try {
    await request(app).post(`/api/ai/use-cases/${USE_CASE}/activate`).set("x-test-role", "admin").set("x-test-user-id", String(userId)).send({});
  } finally {
    mockState.organisationId = previous;
  }
}

async function seedKnownError(organisationId, incidentId, { workaround, closedAt, suffix }) {
  const { rows } = await db.pool.query(
    `INSERT INTO operational_problems (
       organisation_id, problem_number, title, description, status, closure_type, workaround,
       linked_incident_ids, recurrence_count, responsible_user_id, idempotency_key, closed_at
     ) VALUES ($1,$2,'Erreur connue test','Test','closed','known_error',$3,$4::jsonb,1,
               (SELECT responsible_user_id FROM operational_incidents WHERE id=$5),$6,$7)
     RETURNING *`,
    [organisationId, `PRC-REC-${suffix}`, workaround, JSON.stringify([incidentId]), incidentId, `rec-known-error-${suffix}`, closedAt],
  );
  return rows[0];
}

describe("Recommandations et explications — structure et garde-fous (Étage 9 PR C)", () => {
  let app;
  let orgId;
  let userId;

  beforeAll(async () => {
    await seedCatalog();
    const org = await createTestOrganisation({ nom: "AI Recommendations E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    userId = user.id;
    app = buildApp();
    await activateForOrg(app, orgId, userId);
  });

  test("refusé (403) tant que le cas d'usage n'est pas activé pour l'organisation", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Recommendations E2E Org No Activation" });
    const previous = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
        .send({ title: "Incident", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-rec-noactivation", idempotencyKey: "rec-noact-0001" });
      const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incident.body.incident.id}`).set("x-test-role", "admin");
      expect(res.status).toBe(403);
    } finally {
      mockState.organisationId = previous;
    }
  });

  test("aucune source interne : aucune recommandation fabriquée, raison explicite", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Incident sans historique", description: "Test", severity: "medium", impactSummary: "Impact", serviceKey: "svc-rec-nosource", idempotencyKey: "rec-nosource-0001" });

    const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incident.body.incident.id}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toBeNull();
    expect(res.body.reason).toBe("no_internal_source");
    // Le contexte (vide) reste renvoyé : jamais masqué même sans suggestion.
    expect(res.body.context.knownErrors).toEqual([]);
  });

  test("recommandation structurée avec une seule erreur connue ancienne : confiance faible/moyenne, taxonomie complète", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Panne API paiement", description: "Test", severity: "critical", impactSummary: "Impact", serviceKey: "svc-rec-payment", idempotencyKey: "rec-payment-0001" });
    const incidentId = incident.body.incident.id;
    const old = new Date();
    old.setDate(old.getDate() - 200);
    const knownError = await seedKnownError(orgId, incidentId, { workaround: "Basculer vers le fournisseur de secours", closedAt: old.toISOString(), suffix: "old-1" });

    const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incidentId}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    const rec = res.body.recommendation;
    expect(rec).toBeTruthy();
    expect(rec.confidence).toBe("low");
    expect(rec.suggestion.type).toBe("suggestion");
    expect(rec.suggestion.text).toContain("Basculer vers le fournisseur de secours");
    expect(rec.facts.every((f) => f.type === "fact")).toBe(true);
    expect(rec.calculations.every((c) => c.type === "calculation")).toBe(true);
    expect(rec.hypotheses.every((h) => h.type === "hypothesis")).toBe(true);
    expect(rec.facts.some((f) => String(f.source.problemId) === String(knownError.id))).toBe(true);
    expect(Array.isArray(rec.limits)).toBe(true);
    expect(rec.limits.length).toBeGreaterThan(0);
    expect(rec.expiresAt).toBe(res.body.context.validity.validUntil);
    expect(new Date(rec.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("confiance plus élevée avec plusieurs erreurs connues récentes", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Panne file d'attente", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-rec-queue", idempotencyKey: "rec-queue-0001" });
    const incidentId = incident.body.incident.id;
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    await seedKnownError(orgId, incidentId, { workaround: "Purger la file bloquée", closedAt: recent.toISOString(), suffix: "recent-1" });

    const secondIncident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Deuxième incident file", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-rec-queue", idempotencyKey: "rec-queue-0002" });
    await seedKnownError(orgId, secondIncident.body.incident.id, { workaround: "Redémarrer le worker", closedAt: recent.toISOString(), suffix: "recent-2" });

    const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incidentId}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.recommendation.confidence).toBe("high");
    expect(res.body.recommendation.calculations[0].value).toBe(2);
  });

  test("isolation stricte : une erreur connue d'une autre organisation ne peut jamais nourrir une recommandation", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Recommendations E2E Org B" });
    const otherUser = await createTestUser({ organisation_id: otherOrg.id, role: "admin" });
    await activateForOrg(app, otherOrg.id, otherUser.id);

    const previous = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const otherIncident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
        .send({ title: "Incident org B", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-rec-payment", idempotencyKey: "rec-orgb-0001" });
      await seedKnownError(otherOrg.id, otherIncident.body.incident.id, { workaround: "Contournement org B", closedAt: new Date().toISOString(), suffix: "orgb-1" });
    } finally {
      mockState.organisationId = previous;
    }

    const incidentOrgA = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Troisième incident paiement org A", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-rec-payment", idempotencyKey: "rec-payment-0002" });
    const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incidentOrgA.body.incident.id}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.recommendation.suggestion.text).not.toContain("org B");
  });
});
