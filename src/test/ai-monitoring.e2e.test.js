// Étage 9 PR G — Surveillance des dérives et coûts (issue #195).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// métriques réelles calculées depuis le journal d'audit (taux
// d'acceptation/correction/refus, latence moyenne, coût toujours 0 —
// documenté, pas fabriqué), dérive de couverture détectée sur un
// échantillon réel de refus, dérive de faible acceptation détectée,
// aucune dérive sur un échantillon sain, arrêt contrôlé qui RÉUTILISE la
// désactivation existante (PR A) et exige un motif, RBAC, isolation
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

const aiMonitoringRoutes = require("../routes/business/ai-monitoring.routes");
const aiUseCasesRoutes = require("../routes/business/ai-use-cases.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/ai/monitoring", aiMonitoringRoutes);
  app.use("/api/ai/use-cases", aiUseCasesRoutes);
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

async function seedAuditEntry(organisationId, { hasRecommendation, humanDecision = null, durationMs = 50, suffix }) {
  await db.pool.query(
    `INSERT INTO ai_audit_log (
       organisation_id, use_case_id, use_case_version, engine_contract, request_context,
       authorized_context_summary, result_summary, correlation, human_decision, human_decision_by, human_decision_at,
       retention_class, retention_until, duration_ms
     ) VALUES ($1,$2,'1.0','ai-recommendation@1','{}'::jsonb,'{}'::jsonb,$3::jsonb,'{}'::jsonb,$4::text,NULL,
               CASE WHEN $4::text IS NOT NULL THEN NOW() ELSE NULL END,'short',NOW() + interval '90 days',$5)`,
    [organisationId, USE_CASE, JSON.stringify({ hasRecommendation }), humanDecision, durationMs],
  );
  void suffix; // conservé dans les appels pour la lisibilité des scénarios, non persisté (pas de colonne dédiée)
}

describe("Surveillance des dérives et coûts — métriques réelles (Étage 9 PR G)", () => {
  let app;
  let orgId;
  let adminId;

  beforeAll(async () => {
    await db.pool.query(
      `INSERT INTO ai_use_cases (id, version, owner, status, autonomy, risk_level, data_classes, description)
       VALUES ($1,'1.0','operations-lead','approved','advisory','low','["operational_incidents"]'::jsonb,'Test')
       ON CONFLICT (id, version) DO NOTHING`,
      [USE_CASE],
    );
    const org = await createTestOrganisation({ nom: "AI Monitoring E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const admin = await createTestUser({ organisation_id: orgId, role: "admin" });
    adminId = admin.id;
    mockState.userId = adminId;
    app = buildApp();
    await activateForOrg(app, orgId, adminId);
  });

  test("un employé ne peut pas consulter les métriques", async () => {
    const res = await request(app).get(`/api/ai/monitoring/${USE_CASE}/metrics`).set("x-test-role", "employe");
    expect(res.status).toBe(403);
  });

  test("échantillon sain (peu de refus, bonne acceptation) : aucune dérive, coût toujours 0", async () => {
    for (let i = 0; i < 3; i += 1) await seedAuditEntry(orgId, { hasRecommendation: true, humanDecision: "confirmed", durationMs: 40, suffix: `healthy-${i}` });
    const res = await request(app).get(`/api/ai/monitoring/${USE_CASE}/metrics`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.metrics.driftFlags).toEqual([]);
    expect(res.body.metrics.recommendedAction).toBe("none");
    expect(res.body.metrics.costEstimate.total).toBe(0);
    expect(res.body.metrics.acceptanceRate).toBe(1);
    expect(res.body.metrics.avgDurationMs).toBe(40);
  });

  test("dérive de couverture détectée : majorité de refus sur un échantillon suffisant", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Monitoring E2E Org Drift Coverage" });
    const otherAdmin = await createTestUser({ organisation_id: otherOrg.id, role: "admin" });
    await activateForOrg(app, otherOrg.id, otherAdmin.id);

    for (let i = 0; i < 4; i += 1) await seedAuditEntry(otherOrg.id, { hasRecommendation: false, suffix: `coverage-norec-${i}` });
    await seedAuditEntry(otherOrg.id, { hasRecommendation: true, humanDecision: "confirmed", suffix: "coverage-rec-1" });

    const previous = mockState.organisationId;
    const previousUser = mockState.userId;
    mockState.organisationId = otherOrg.id;
    mockState.userId = otherAdmin.id;
    try {
      const res = await request(app).get(`/api/ai/monitoring/${USE_CASE}/metrics`).set("x-test-role", "admin").set("x-test-user-id", String(otherAdmin.id));
      expect(res.status).toBe(200);
      expect(res.body.metrics.total).toBe(5);
      expect(res.body.metrics.driftFlags.some((f) => f.code === "coverage_drift")).toBe(true);
      expect(res.body.metrics.recommendedAction).toBe("kill_switch_recommended");
    } finally {
      mockState.organisationId = previous;
      mockState.userId = previousUser;
    }
  });

  test("dérive de faible acceptation détectée : majorité de refus humains", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Monitoring E2E Org Drift Acceptance" });
    const otherAdmin = await createTestUser({ organisation_id: otherOrg.id, role: "admin" });
    await activateForOrg(app, otherOrg.id, otherAdmin.id);

    await seedAuditEntry(otherOrg.id, { hasRecommendation: true, humanDecision: "confirmed", suffix: "acc-1" });
    await seedAuditEntry(otherOrg.id, { hasRecommendation: true, humanDecision: "declined", suffix: "acc-2" });
    await seedAuditEntry(otherOrg.id, { hasRecommendation: true, humanDecision: "declined", suffix: "acc-3" });
    await seedAuditEntry(otherOrg.id, { hasRecommendation: true, humanDecision: "declined", suffix: "acc-4" });

    const previous = mockState.organisationId;
    const previousUser = mockState.userId;
    mockState.organisationId = otherOrg.id;
    mockState.userId = otherAdmin.id;
    try {
      const res = await request(app).get(`/api/ai/monitoring/${USE_CASE}/metrics`).set("x-test-role", "admin").set("x-test-user-id", String(otherAdmin.id));
      expect(res.body.metrics.driftFlags.some((f) => f.code === "low_acceptance_drift")).toBe(true);
      expect(res.body.metrics.acceptanceRate).toBeCloseTo(0.25, 2);
    } finally {
      mockState.organisationId = previous;
      mockState.userId = previousUser;
    }
  });

  test("arrêt contrôlé : motif obligatoire, réutilise la désactivation existante (PR A)", async () => {
    const missingReason = await request(app).post(`/api/ai/monitoring/${USE_CASE}/kill-switch`).set("x-test-role", "admin").send({});
    expect(missingReason.status).toBe(400);

    const killed = await request(app).post(`/api/ai/monitoring/${USE_CASE}/kill-switch`).set("x-test-role", "admin")
      .send({ reason: "Dérive de couverture confirmée sur 3 jours" });
    expect(killed.status).toBe(200);
    expect(killed.body.activation.status).toBe("disabled");
    expect(killed.body.activation.disabled_reason).toContain("Dérive de couverture confirmée");

    const activationsList = await request(app).get("/api/ai/use-cases/activations").set("x-test-role", "admin");
    expect(activationsList.body.activations.find((a) => a.use_case_id === USE_CASE).status).toBe("disabled");
  });

  test("isolation stricte : les métriques d'une organisation sont invisibles depuis une autre", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Monitoring E2E Org Isolation" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const res = await request(app).get(`/api/ai/monitoring/${USE_CASE}/metrics`).set("x-test-role", "admin");
      expect(res.body.metrics.total).toBe(0);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
