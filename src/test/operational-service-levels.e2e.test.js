// Étage 8 PR E — Niveaux de service et objectifs (issue #194).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// définition d'objectifs (une redéfinition retire l'ancienne plutôt que
// de la perdre), calcul réel de disponibilité/délais/budget d'erreur à
// partir d'incidents réels (PR B, seedés directement en base avec des
// horodatages contrôlés), alertes de dérive qui n'apparaissent que pour
// les services réellement en dérive et qui n'occultent jamais les
// incidents qui les composent, RBAC et isolation multi-organisation.
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

const operationalServiceLevelsRoutes = require("../routes/business/operational-service-levels.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/service-levels", operationalServiceLevelsRoutes);
  return app;
}

async function seedIncident(organisationId, responsibleUserId, { serviceKey, declaredAt, containedAt, restoredAt, suffix }) {
  const { rows } = await db.pool.query(
    `INSERT INTO operational_incidents (
       organisation_id, incident_number, service_key, title, description, severity,
       impact_summary, status, responsible_user_id, declared_at, contained_at, restored_at, idempotency_key
     ) VALUES ($1,$2,$3,'Incident SLO test','Test','high','Impact test','restored',$4,$5,$6,$7,$8)
     RETURNING *`,
    [organisationId, `INC-SLO-${suffix}`, serviceKey, responsibleUserId, declaredAt, containedAt || null, restoredAt || null, `slo-seed-${suffix}`],
  );
  return rows[0];
}

describe("Niveaux de service et objectifs — calcul réel (Étage 8 PR E)", () => {
  let app;
  let orgId;
  let userId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Operational SLO E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    userId = user.id;
    app = buildApp();
  });

  test("un employé ne peut ni lister ni définir d'objectif", async () => {
    const list = await request(app).get("/api/operations/service-levels").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/operations/service-levels").set("x-test-role", "employe")
      .send({ serviceKey: "x", availabilityTarget: 99, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60 });
    expect(create.status).toBe(403);
  });

  test("validations : service, cible de disponibilité et délais invalides rejetés", async () => {
    const missingService = await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ availabilityTarget: 99, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60 });
    expect(missingService.status).toBe(400);

    const badAvailability = await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-validation", availabilityTarget: 150, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60 });
    expect(badAvailability.status).toBe(400);

    const badDelays = await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-validation", availabilityTarget: 99, responseTimeTargetMinutes: 0, restorationTimeTargetMinutes: 60 });
    expect(badDelays.status).toBe(400);
  });

  test("redéfinir un objectif retire l'ancien plutôt que de le perdre", async () => {
    const first = await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-redefine", availabilityTarget: 90, responseTimeTargetMinutes: 30, restorationTimeTargetMinutes: 120, idempotencyKey: "slo-redefine-0001" });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-redefine", availabilityTarget: 95, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60, idempotencyKey: "slo-redefine-0002" });
    expect(second.status).toBe(201);

    const list = await request(app).get("/api/operations/service-levels").query({ serviceKey: "svc-redefine" }).set("x-test-role", "admin");
    expect(list.body.objectives).toHaveLength(1);
    expect(Number(list.body.objectives[0].availability_target)).toBe(95);

    const retired = await db.pool.query(
      "SELECT status FROM operational_slo_objectives WHERE organisation_id=$1 AND service_key='svc-redefine' AND idempotency_key='slo-redefine-0001'",
      [orgId],
    );
    expect(retired.rows[0].status).toBe("retired");
  });

  test("résultats sans objectif actif : 404 ; période invalide : 400", async () => {
    const noObjective = await request(app).get("/api/operations/service-levels/results")
      .query({ serviceKey: "svc-inexistant", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-02T00:00:00Z" })
      .set("x-test-role", "admin");
    expect(noObjective.status).toBe(404);

    await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-period", availabilityTarget: 99, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60, idempotencyKey: "slo-period-0001" });
    const badPeriod = await request(app).get("/api/operations/service-levels/results")
      .query({ serviceKey: "svc-period", periodStart: "2026-01-02T00:00:00Z", periodEnd: "2026-01-01T00:00:00Z" })
      .set("x-test-role", "admin");
    expect(badPeriod.status).toBe(400);
  });

  test("calcul réel : service dans son budget d'erreur n'apparaît pas dans les alertes", async () => {
    await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-slo-ok", availabilityTarget: 90, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 120, idempotencyKey: "slo-ok-0001" });
    await seedIncident(orgId, userId, {
      serviceKey: "svc-slo-ok",
      declaredAt: "2026-01-01T01:00:00Z",
      containedAt: "2026-01-01T01:10:00Z",
      restoredAt: "2026-01-01T02:00:00Z", // 60 min downtime sur 1440 min = budget de 144 min (10%) : dans le budget
      suffix: "ok-1",
    });

    const results = await request(app).get("/api/operations/service-levels/results")
      .query({ serviceKey: "svc-slo-ok", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-02T00:00:00Z" })
      .set("x-test-role", "admin");
    expect(results.status).toBe(200);
    expect(results.body.result.availabilityBreached).toBe(false);
    expect(results.body.result.errorBudget.breached).toBe(false);
    expect(results.body.result.avgResponseTimeMinutes).toBe(10);
    expect(results.body.result.avgRestorationTimeMinutes).toBe(60);
    expect(results.body.result.incidentsConsidered).toHaveLength(1);

    const alerts = await request(app).get("/api/operations/service-levels/alerts")
      .query({ periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-02T00:00:00Z" })
      .set("x-test-role", "admin");
    expect(alerts.status).toBe(200);
    expect(alerts.body.alerts.some((a) => a.serviceKey === "svc-slo-ok")).toBe(false);
  });

  test("calcul réel : service en dérive apparaît dans les alertes SANS masquer l'incident qui la compose", async () => {
    await request(app).post("/api/operations/service-levels").set("x-test-role", "manager")
      .send({ serviceKey: "svc-slo-breach", availabilityTarget: 99.9, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60, idempotencyKey: "slo-breach-0001" });
    const incident = await seedIncident(orgId, userId, {
      serviceKey: "svc-slo-breach",
      declaredAt: "2026-01-01T00:00:00Z",
      containedAt: "2026-01-01T00:30:00Z",
      restoredAt: "2026-01-01T03:20:00Z", // 200 min de panne, budget de 99.9% sur 1440 min = 1.44 min
      suffix: "breach-1",
    });

    const results = await request(app).get("/api/operations/service-levels/results")
      .query({ serviceKey: "svc-slo-breach", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-02T00:00:00Z" })
      .set("x-test-role", "admin");
    expect(results.body.result.availabilityBreached).toBe(true);
    expect(results.body.result.errorBudget.breached).toBe(true);
    expect(results.body.result.errorBudget.remainingMinutes).toBeLessThan(0);
    expect(results.body.result.restorationTimeBreached).toBe(true);

    const alerts = await request(app).get("/api/operations/service-levels/alerts")
      .query({ periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-02T00:00:00Z" })
      .set("x-test-role", "admin");
    const breachAlert = alerts.body.alerts.find((a) => a.serviceKey === "svc-slo-breach");
    expect(breachAlert).toBeTruthy();
    // L'agrégat n'occulte jamais l'incident réel qui le justifie.
    expect(breachAlert.incidentsConsidered.some((i) => String(i.id) === String(incident.id))).toBe(true);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Operational SLO E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/operations/service-levels").set("x-test-role", "admin");
      expect(list.body.objectives).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
