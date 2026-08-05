// Étage 9 PR B — Contexte institutionnel contrôlé (issue #195).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// contexte refusé tant que le cas d'usage n'est pas activé pour
// l'organisation (PR A), assemblage réel à partir d'erreurs connues
// existantes (Étage 8 PR C), champs minimisés (aucun id interne/evidence
// exposé), provenance et période de validité présentes, incident
// introuvable en 404, et isolation stricte : une erreur connue d'une
// autre organisation avec le même service_key n'apparaît jamais.
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

const aiContextRoutes = require("../routes/business/ai-context.routes");
const aiUseCasesRoutes = require("../routes/business/ai-use-cases.routes");
const operationalIncidentsRoutes = require("../routes/business/operational-incidents.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/ai/context", aiContextRoutes);
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

async function seedKnownError(organisationId, incidentId, { workaround, suffix }) {
  const { rows } = await db.pool.query(
    `INSERT INTO operational_problems (
       organisation_id, problem_number, title, description, status, closure_type, workaround,
       linked_incident_ids, recurrence_count, responsible_user_id, idempotency_key
     ) VALUES ($1,$2,'Erreur connue test','Test','closed','known_error',$3,$4::jsonb,1,
               (SELECT responsible_user_id FROM operational_incidents WHERE id=$5),$6)
     RETURNING *`,
    [organisationId, `PRB-CTX-${suffix}`, workaround, JSON.stringify([incidentId]), incidentId, `ctx-known-error-${suffix}`],
  );
  return rows[0];
}

describe("Contexte institutionnel contrôlé — erreurs connues (Étage 9 PR B)", () => {
  let app;
  let orgId;
  let userId;

  beforeAll(async () => {
    await seedCatalog();
    const org = await createTestOrganisation({ nom: "AI Context E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    userId = user.id;
    app = buildApp();
  });

  test("contexte refusé (403) tant que le cas d'usage n'est pas activé pour l'organisation", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Incident test", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-ctx-notactivated", idempotencyKey: "ctx-notactivated-0001" });

    const res = await request(app).get(`/api/ai/context/incident-known-error-suggestion/${incident.body.incident.id}`).set("x-test-role", "admin");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ai.use_case_not_activated");
  });

  test("après activation, incident introuvable renvoie 404", async () => {
    await activateForOrg(app, orgId, userId);
    const res = await request(app).get("/api/ai/context/incident-known-error-suggestion/999999999").set("x-test-role", "admin");
    expect(res.status).toBe(404);
  });

  test("assemblage réel : erreur connue du même service retournée avec champs minimisés, provenance et validité", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Panne API paiement", description: "Test", severity: "critical", impactSummary: "Impact", serviceKey: "svc-ctx-payment", idempotencyKey: "ctx-payment-0001" });
    const incidentId = incident.body.incident.id;

    const knownError = await seedKnownError(orgId, incidentId, { workaround: "Basculer vers le fournisseur de secours", suffix: "1" });

    const res = await request(app).get(`/api/ai/context/incident-known-error-suggestion/${incidentId}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.context.subject.incidentId).toBe(String(incidentId));
    expect(res.body.context.subject.serviceKey).toBe("svc-ctx-payment");
    expect(res.body.context.knownErrors).toHaveLength(1);
    expect(res.body.context.knownErrors[0].workaround).toBe("Basculer vers le fournisseur de secours");
    expect(String(res.body.context.knownErrors[0].problemId)).toBe(String(knownError.id));

    // Champs minimisés : aucun id interne / evidence exposé.
    expect(res.body.context.knownErrors[0]).not.toHaveProperty("responsible_user_id");
    expect(res.body.context.knownErrors[0]).not.toHaveProperty("evidence");
    expect(res.body.context.knownErrors[0]).not.toHaveProperty("linked_incident_ids");
    expect(res.body.context.knownErrors[0]).not.toHaveProperty("organisation_id");

    // Provenance et période de validité présentes et cohérentes.
    expect(res.body.context.provenance[0]).toEqual(expect.objectContaining({ source: "operational_problems", id: expect.anything() }));
    expect(new Date(res.body.context.validity.validUntil).getTime()).toBeGreaterThan(new Date(res.body.context.validity.fetchedAt).getTime());
  });

  test("une erreur connue d'un autre service n'apparaît pas ; incident sans erreur connue renvoie une liste vide", async () => {
    const incidentOtherService = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Incident service isolé", description: "Test", severity: "low", impactSummary: "Impact", serviceKey: "svc-ctx-isolated", idempotencyKey: "ctx-isolated-0001" });

    const res = await request(app).get(`/api/ai/context/incident-known-error-suggestion/${incidentOtherService.body.incident.id}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.context.knownErrors).toEqual([]);
  });

  test("isolation stricte : une erreur connue d'une autre organisation avec le même service_key n'apparaît jamais", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Context E2E Org B" });
    const otherUser = await createTestUser({ organisation_id: otherOrg.id, role: "admin" });
    await activateForOrg(app, otherOrg.id, otherUser.id);

    const previous = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    let otherIncidentId;
    try {
      const otherIncident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
        .send({ title: "Incident org B", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-ctx-payment", idempotencyKey: "ctx-orgb-0001" });
      otherIncidentId = otherIncident.body.incident.id;
      await seedKnownError(otherOrg.id, otherIncidentId, { workaround: "Contournement propre à l'organisation B", suffix: "orgb-1" });
    } finally {
      mockState.organisationId = previous;
    }

    // Un nouvel incident org A sur le même service_key ne doit voir QUE
    // l'erreur connue de l'org A, jamais celle de l'org B.
    const incidentOrgA = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Deuxième incident org A", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-ctx-payment", idempotencyKey: "ctx-payment-0002" });
    const res = await request(app).get(`/api/ai/context/incident-known-error-suggestion/${incidentOrgA.body.incident.id}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.context.knownErrors.some((e) => e.workaround === "Contournement propre à l'organisation B")).toBe(false);

    // Et l'incident de l'org B reste bien invisible depuis l'org A (404, pas une fuite silencieuse).
    const crossOrgFetch = await request(app).get(`/api/ai/context/incident-known-error-suggestion/${otherIncidentId}`).set("x-test-role", "admin");
    expect(crossOrgFetch.status).toBe(404);
  });
});
