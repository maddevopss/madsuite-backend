// Plans de mesures d'urgence SST (mandat SST) : nouvelle conception, aucun
// orphelin -- 074_sst_transactional_core.sql ne couvrait pas ce besoin. Ce
// test exécute par de vraies requêtes HTTP contre une vraie base : cycle de
// vie complet (brouillon -> actif -> retiré), exercice d'urgence rattaché,
// transitions invalides, doublon de code, isolation multi-organisation.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

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
  if (role) req.user = { id: userId ? Number(userId) : null, role };
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

describe("Plans de mesures d'urgence SST (nouvelle conception)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("cycle de vie complet : brouillon -> actif -> exercice enregistré -> retiré", async () => {
    const org = await createTestOrganisation({ nom: "SST Emergency Plans E2E Lifecycle" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });

    const created = await request(app)
      .post("/api/sst/emergency-plans")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ planCode: "PLAN-INCENDIE", scenarioType: "fire", title: "Plan incendie", procedure: "Évacuer par les sorties de secours.", assemblyPoint: "Stationnement nord", idempotencyKey: "plan-lifecycle-0001" });
    expect(created.status).toBe(201);
    expect(created.body.plan.status).toBe("draft");
    const planId = created.body.plan.id;

    // Un exercice ne peut pas être enregistré tant que le plan n'est pas actif.
    const drillBeforeActivation = await request(app)
      .post("/api/sst/emergency-drills")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ planId, conductedAt: "2026-08-01T10:00:00Z", idempotencyKey: "drill-early-0001" });
    expect(drillBeforeActivation.status).toBe(409);

    const activated = await request(app)
      .post(`/api/sst/emergency-plans/${planId}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "plan-activate-0001" });
    expect(activated.status).toBe(200);
    expect(activated.body.plan.status).toBe("active");

    // Une seconde activation est refusée (le plan n'est plus à l'état brouillon).
    const reActivate = await request(app)
      .post(`/api/sst/emergency-plans/${planId}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "plan-activate-0002" });
    expect(reActivate.status).toBe(409);

    const drill = await request(app)
      .post("/api/sst/emergency-drills")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ planId, conductedAt: "2026-08-01T10:00:00Z", participantsCount: 12, observations: "RAS", idempotencyKey: "drill-lifecycle-0001" });
    expect(drill.status).toBe(201);

    const stored = await db.pool.query("SELECT last_drill_at FROM sst_emergency_plans WHERE organisation_id=$1 AND id=$2", [org.id, planId]);
    expect(stored.rows[0].last_drill_at).not.toBeNull();

    const retired = await request(app)
      .post(`/api/sst/emergency-plans/${planId}/retire`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ reason: "Procédure remplacée", idempotencyKey: "plan-retire-0001" });
    expect(retired.status).toBe(200);
    expect(retired.body.plan.status).toBe("retired");

    // Retirer un plan déjà retiré est refusé.
    const reRetire = await request(app)
      .post(`/api/sst/emergency-plans/${planId}/retire`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ reason: "Encore", idempotencyKey: "plan-retire-0002" });
    expect(reRetire.status).toBe(409);
  });

  test("retirer un plan sans raison est refusé, un code de plan dupliqué est refusé, idempotence sur la création", async () => {
    const org = await createTestOrganisation({ nom: "SST Emergency Plans E2E Validation" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });

    const first = await request(app)
      .post("/api/sst/emergency-plans")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ planCode: "PLAN-CHIMIQUE", scenarioType: "chemical_spill", title: "Déversement chimique", procedure: "Confiner et évacuer.", idempotencyKey: "plan-dup-0001" });
    expect(first.status).toBe(201);

    const duplicateCode = await request(app)
      .post("/api/sst/emergency-plans")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ planCode: "PLAN-CHIMIQUE", scenarioType: "chemical_spill", title: "Bis", procedure: "Autre procédure.", idempotencyKey: "plan-dup-0002" });
    expect(duplicateCode.status).toBe(409);

    const replay = await request(app)
      .post("/api/sst/emergency-plans")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ planCode: "PLAN-CHIMIQUE", scenarioType: "chemical_spill", title: "Déversement chimique", procedure: "Confiner et évacuer.", idempotencyKey: "plan-dup-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    const activated = await request(app)
      .post(`/api/sst/emergency-plans/${first.body.plan.id}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "plan-dup-activate-0001" });
    expect(activated.status).toBe(200);

    const retireNoReason = await request(app)
      .post(`/api/sst/emergency-plans/${first.body.plan.id}/retire`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ idempotencyKey: "plan-dup-retire-0001" });
    expect(retireNoReason.status).toBe(400);
  });

  test("isolation stricte : un plan d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "SST Emergency Plans E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "SST Emergency Plans E2E Org B" });

    mockState.organisationId = orgA.id;
    const userA = await createTestUser({ organisation_id: orgA.id, role: "admin" });
    const plan = await request(app)
      .post("/api/sst/emergency-plans")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(userA.id))
      .send({ planCode: "PLAN-ISO", scenarioType: "medical", title: "Isolation", procedure: "Procédure.", idempotencyKey: "plan-iso-0001" });
    expect(plan.status).toBe(201);

    mockState.organisationId = orgB.id;
    const userB = await createTestUser({ organisation_id: orgB.id, role: "admin" });
    const crossOrgActivate = await request(app)
      .post(`/api/sst/emergency-plans/${plan.body.plan.id}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(userB.id))
      .send({ idempotencyKey: "plan-iso-activate-0001" });
    expect(crossOrgActivate.status).toBe(404);
  });
});
