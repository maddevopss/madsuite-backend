// Étage 8 PR F — Coûts et capacité (issue #194).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// relevés de consommation en unités physiques (jamais de montant), seuils
// (redéfinition retire l'ancien), prévision de capacité par régression
// linéaire réelle sur des relevés à horodatages contrôlés, alertes de
// dérive avec le relevé réel qui les justifie, RBAC et isolation
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

const operationalCapacityRoutes = require("../routes/business/operational-capacity.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/capacity", operationalCapacityRoutes);
  return app;
}

async function seedUsage(organisationId, userId, { serviceKey, resourceType, quantity, recordedAt, suffix }) {
  const { rows } = await db.pool.query(
    `INSERT INTO operational_capacity_usage (
       organisation_id, service_key, resource_type, unit, quantity, recorded_at, idempotency_key, created_by
     ) VALUES ($1,$2,$3,'GB',$4,$5,$6,$7) RETURNING *`,
    [organisationId, serviceKey, resourceType, quantity, recordedAt, `cap-seed-${suffix}`, userId],
  );
  return rows[0];
}

describe("Coûts et capacité — relevés, seuils, prévisions (Étage 8 PR F)", () => {
  let app;
  let orgId;
  let userId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Operational Capacity E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    userId = user.id;
    app = buildApp();
  });

  test("un employé ne peut ni lister ni enregistrer de relevé", async () => {
    const list = await request(app).get("/api/operations/capacity/usage").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/operations/capacity/usage").set("x-test-role", "employe")
      .send({ serviceKey: "x", resourceType: "storage", unit: "GB", quantity: 10 });
    expect(create.status).toBe(403);
  });

  test("validations : champs obligatoires, type invalide, fournisseur manquant rejetés", async () => {
    const missingFields = await request(app).post("/api/operations/capacity/usage").set("x-test-role", "manager").send({});
    expect(missingFields.status).toBe(400);

    const badType = await request(app).post("/api/operations/capacity/usage").set("x-test-role", "manager")
      .send({ serviceKey: "svc", resourceType: "BOGUS", unit: "GB", quantity: 1 });
    expect(badType.status).toBe(400);

    const missingSupplier = await request(app).post("/api/operations/capacity/usage").set("x-test-role", "manager")
      .send({ serviceKey: "svc", resourceType: "supplier", unit: "units", quantity: 1 });
    expect(missingSupplier.status).toBe(400);

    const negativeQuantity = await request(app).post("/api/operations/capacity/usage").set("x-test-role", "manager")
      .send({ serviceKey: "svc", resourceType: "storage", unit: "GB", quantity: -1 });
    expect(negativeQuantity.status).toBe(400);
  });

  test("enregistrement réel d'un relevé, aucun champ monétaire dans la réponse", async () => {
    const res = await request(app).post("/api/operations/capacity/usage").set("x-test-role", "manager")
      .send({ serviceKey: "svc-usage", resourceType: "storage", unit: "GB", quantity: 42.5, idempotencyKey: "cap-usage-e2e-0001" });
    expect(res.status).toBe(201);
    expect(Number(res.body.usage.quantity)).toBe(42.5);
    expect(res.body.usage).not.toHaveProperty("amount");
    expect(res.body.usage).not.toHaveProperty("cost");
  });

  test("redéfinir un seuil retire l'ancien plutôt que de le perdre", async () => {
    const first = await request(app).post("/api/operations/capacity/thresholds").set("x-test-role", "manager")
      .send({ serviceKey: "svc-threshold", resourceType: "storage", capacityLimit: 100, idempotencyKey: "cap-thresh-0001" });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/operations/capacity/thresholds").set("x-test-role", "manager")
      .send({ serviceKey: "svc-threshold", resourceType: "storage", capacityLimit: 200, warningThresholdPercent: 90, idempotencyKey: "cap-thresh-0002" });
    expect(second.status).toBe(201);

    const list = await request(app).get("/api/operations/capacity/thresholds").query({ serviceKey: "svc-threshold" }).set("x-test-role", "admin");
    expect(list.body.thresholds).toHaveLength(1);
    expect(Number(list.body.thresholds[0].capacity_limit)).toBe(200);

    const retired = await db.pool.query(
      "SELECT status FROM operational_capacity_thresholds WHERE organisation_id=$1 AND idempotency_key='cap-thresh-0001'",
      [orgId],
    );
    expect(retired.rows[0].status).toBe("retired");
  });

  test("prévision : données insuffisantes renvoie une réponse explicite, pas une extrapolation inventée", async () => {
    await seedUsage(orgId, userId, { serviceKey: "svc-forecast-empty", resourceType: "storage", quantity: 10, recordedAt: new Date(), suffix: "empty-1" });
    const forecast = await request(app).get("/api/operations/capacity/forecast")
      .query({ serviceKey: "svc-forecast-empty", resourceType: "storage" }).set("x-test-role", "admin");
    expect(forecast.status).toBe(200);
    expect(forecast.body.forecast).toBeNull();
    expect(forecast.body.reason).toBe("insufficient_data");
  });

  test("prévision réelle par régression linéaire sur des relevés croissants, avec seuil de capacité", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Croissance linéaire connue : +10 GB/jour sur 5 jours, de 100 à 140 GB.
    for (let i = 0; i < 5; i += 1) {
      await seedUsage(orgId, userId, {
        serviceKey: "svc-forecast-growth",
        resourceType: "storage",
        quantity: 100 + i * 10,
        recordedAt: new Date(now - (4 - i) * day),
        suffix: `growth-${i}`,
      });
    }
    await request(app).post("/api/operations/capacity/thresholds").set("x-test-role", "manager")
      .send({ serviceKey: "svc-forecast-growth", resourceType: "storage", capacityLimit: 200, idempotencyKey: "cap-thresh-growth-0001" });

    const forecast = await request(app).get("/api/operations/capacity/forecast")
      .query({ serviceKey: "svc-forecast-growth", resourceType: "storage" }).set("x-test-role", "admin");
    expect(forecast.status).toBe(200);
    expect(forecast.body.forecast.dataPoints).toBe(5);
    expect(forecast.body.forecast.currentQuantity).toBe(140);
    expect(forecast.body.forecast.dailyGrowthRate).toBeCloseTo(10, 0);
    // (200-140)/10 = 6 jours avant d'atteindre la limite.
    expect(forecast.body.forecast.daysUntilBreach).toBeCloseTo(6, 0);
    expect(forecast.body.forecast.projectedBreachAt).toBeTruthy();
  });

  test("alertes de dérive incluent le relevé réel qui les justifie", async () => {
    await request(app).post("/api/operations/capacity/thresholds").set("x-test-role", "manager")
      .send({ serviceKey: "svc-alert", resourceType: "storage", capacityLimit: 100, warningThresholdPercent: 80, idempotencyKey: "cap-alert-thresh-0001" });
    const usage = await seedUsage(orgId, userId, { serviceKey: "svc-alert", resourceType: "storage", quantity: 95, recordedAt: new Date(), suffix: "alert-1" });

    const alerts = await request(app).get("/api/operations/capacity/alerts").set("x-test-role", "admin");
    expect(alerts.status).toBe(200);
    const found = alerts.body.alerts.find((a) => a.serviceKey === "svc-alert");
    expect(found).toBeTruthy();
    expect(found.percentUsed).toBe(95);
    expect(found.breached).toBe(false);
    expect(String(found.latestUsage.id)).toBe(String(usage.id));
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Operational Capacity E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/operations/capacity/usage").set("x-test-role", "admin");
      expect(list.body.usage).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
