// Étage 9 PR E — Journal d'audit de l'intelligence (issue #195).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// une génération réelle (PR C) journalise une ligne, avec des champs
// minimisés (aucun texte métier — titre/contournement — dans le
// journal), corrélation à l'incident, conservation dérivée du
// risk_level du catalogue, aucune ligne pour un accès refusé (cas
// d'usage non activé — rien n'a été traité), RBAC et isolation
// multi-organisation.
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
const aiAuditLogRoutes = require("../routes/business/ai-audit-log.routes");
const operationalIncidentsRoutes = require("../routes/business/operational-incidents.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/ai/recommendations", aiRecommendationsRoutes);
  app.use("/api/ai/use-cases", aiUseCasesRoutes);
  app.use("/api/ai/audit-log", aiAuditLogRoutes);
  app.use("/api/operations/incidents", operationalIncidentsRoutes);
  return app;
}

async function activateForOrg(app, organisationId, userId, useCaseId) {
  const previous = mockState.organisationId;
  mockState.organisationId = organisationId;
  try {
    await request(app).post(`/api/ai/use-cases/${useCaseId}/activate`).set("x-test-role", "admin").set("x-test-user-id", String(userId)).send({});
  } finally {
    mockState.organisationId = previous;
  }
}

describe("Journal d'audit de l'intelligence — traçabilité réelle (Étage 9 PR E)", () => {
  let app;
  let orgId;
  let userId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "AI Audit Log E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    userId = user.id;
    app = buildApp();
  });

  test("un employé ne peut pas lire le journal d'audit", async () => {
    const res = await request(app).get("/api/ai/audit-log").set("x-test-role", "employe");
    expect(res.status).toBe(403);
  });

  test("aucune ligne journalisée pour un accès refusé (cas d'usage pas encore activé pour cette organisation)", async () => {
    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Incident test", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-audit-noaudit", idempotencyKey: "audit-noaudit-0001" });
    const incidentId = incident.body.incident.id;

    const attempt = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incidentId}`).set("x-test-role", "admin");
    expect(attempt.status).toBe(403);

    const auditList = await request(app).get("/api/ai/audit-log").query({ incidentId }).set("x-test-role", "admin");
    expect(auditList.body.auditLog).toEqual([]);
  });

  test("génération réelle journalisée : champs minimisés (aucun texte métier), corrélation à l'incident", async () => {
    await db.pool.query(
      `INSERT INTO ai_use_cases (id, version, owner, status, autonomy, risk_level, data_classes, description)
       VALUES ('incident-known-error-suggestion','1.0','operations-lead','approved','advisory','critical','["operational_incidents"]'::jsonb,'Test')
       ON CONFLICT (id, version) DO NOTHING`,
    );
    await activateForOrg(app, orgId, userId, "incident-known-error-suggestion");

    const incident = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Incident sensible - client XYZ", description: "Détails confidentiels", severity: "critical", impactSummary: "Impact", serviceKey: "svc-audit-main", idempotencyKey: "audit-main-0001" });
    const incidentId = incident.body.incident.id;

    const res = await request(app).get(`/api/ai/recommendations/incident-known-error-suggestion/${incidentId}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.auditEntryId).toBeTruthy();

    const auditList = await request(app).get("/api/ai/audit-log").query({ incidentId }).set("x-test-role", "admin");
    expect(auditList.status).toBe(200);
    expect(auditList.body.auditLog).toHaveLength(1);
    const entry = auditList.body.auditLog[0];
    expect(entry.correlation.objectId).toBe(String(incidentId));
    expect(entry.correlation.objectType).toBe("operational_incident");
    expect(entry.result_summary.hasRecommendation).toBe(false); // aucune erreur connue seedée pour ce service

    // Champs minimisés : jamais le texte métier (titre d'incident sensible).
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("client XYZ");
    expect(serialized).not.toContain("confidentiels");

    // Conservation dérivée du risk_level 'critical' → classe 'extended'.
    expect(entry.retention_class).toBe("extended");
    expect(new Date(entry.retention_until).getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 60 * 60 * 1000);

    expect(entry.human_decision).toBeNull();
  });

  test("isolation stricte : le journal d'une organisation est invisible depuis une autre", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Audit Log E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/ai/audit-log").set("x-test-role", "admin");
      expect(list.body.auditLog).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
