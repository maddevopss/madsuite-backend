// Étage 8 PR B — Incidents opérationnels (issue #194).
// Constat préalable (voir commentaires d'issue #194, 2026-08-03/05) : seule
// la PR A (registre des services, src/operations/serviceRegistry.js) existe
// réellement sur main — la chaîne de PR #201-#244 qui prétendait fermer
// 8B à 8H a été fusionnée sur des branches feat/stage8-* jamais intégrées à
// main, et le "Closes #194" de la PR #244 n'a jamais fermé l'issue. Ce test
// exécute par de vraies requêtes HTTP contre une vraie base le cycle complet
// declared → contained → restored → closed du registre d'incidents
// opérationnels introduit par cette PR : RBAC, validations, transitions
// explicites (preuve de rétablissement + cause provisoire obligatoires),
// idempotence et isolation multi-organisation.
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/incidents", operationalIncidentsRoutes);
  return app;
}

describe("Incidents opérationnels — cycle complet (Étage 8 PR B)", () => {
  let app;
  let orgId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Operational Incidents E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    app = buildApp();
  });

  test("un employé ne peut ni lister ni déclarer d'incident", async () => {
    const list = await request(app).get("/api/operations/incidents").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/operations/incidents").set("x-test-role", "employe")
      .send({ title: "Panne", description: "Test", severity: "high", impactSummary: "Impact", serviceKey: "svc-1" });
    expect(create.status).toBe(403);
  });

  test("validations : champs obligatoires et gravité invalide rejetés", async () => {
    const missingFields = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").send({});
    expect(missingFields.status).toBe(400);

    const badSeverity = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Panne", description: "Test", severity: "BOGUS", impactSummary: "Impact", serviceKey: "svc-1" });
    expect(badSeverity.status).toBe(400);

    const missingService = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({ title: "Panne", description: "Test", severity: "high", impactSummary: "Impact" });
    expect(missingService.status).toBe(400);
  });

  test("déclaration réelle, idempotence sur la même clé", async () => {
    const res = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({
        title: "API de facturation indisponible",
        description: "Erreurs 500 en rafale sur /api/billing",
        severity: "critical",
        impactSummary: "Facturation bloquée pour tous les clients",
        serviceKey: "billing-api",
        idempotencyKey: "inc-e2e-0001",
      });
    expect(res.status).toBe(201);
    expect(res.body.incident.status).toBe("declared");
    expect(res.body.incident.service_key).toBe("billing-api");
    expect(res.body.incident.declared_at).toBeTruthy();

    const replay = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({
        title: "AUTRE TITRE",
        description: "Autre description",
        severity: "low",
        impactSummary: "Autre",
        serviceKey: "autre-service",
        idempotencyKey: "inc-e2e-0001",
      });
    expect(replay.status).toBe(201);
    expect(replay.body.incident.title).toBe("API de facturation indisponible"); // valeurs d'origine, pas rejouées

    const count = await db.pool.query(
      "SELECT COUNT(*)::int n FROM operational_incidents WHERE organisation_id=$1 AND idempotency_key='inc-e2e-0001'",
      [orgId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  test("cycle de transition complet : contenu → rétabli (preuve+cause obligatoires) → fermé", async () => {
    const created = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({
        title: "Latence élevée API paiements",
        description: "P95 > 5s sur /api/payments",
        severity: "high",
        impactSummary: "Paiements ralentis",
        serviceKey: "payments-api",
        idempotencyKey: "inc-e2e-cycle-0001",
      });
    const id = created.body.incident.id;

    const restoreBeforeContain = await request(app).post(`/api/operations/incidents/${id}/restore`).set("x-test-role", "admin")
      .send({ restorationProof: "Déploiement du correctif", provisionalCause: "Fuite de connexions DB" });
    expect(restoreBeforeContain.status).toBe(409);

    const contained = await request(app).post(`/api/operations/incidents/${id}/contain`).set("x-test-role", "admin");
    expect(contained.status).toBe(200);
    expect(contained.body.incident.status).toBe("contained");
    expect(contained.body.incident.contained_at).toBeTruthy();

    const restoreWithoutProof = await request(app).post(`/api/operations/incidents/${id}/restore`).set("x-test-role", "admin").send({});
    expect(restoreWithoutProof.status).toBe(400);

    const restored = await request(app).post(`/api/operations/incidents/${id}/restore`).set("x-test-role", "admin")
      .send({ restorationProof: "Déploiement du correctif de pool de connexions", provisionalCause: "Fuite de connexions DB" });
    expect(restored.status).toBe(200);
    expect(restored.body.incident.status).toBe("restored");
    expect(restored.body.incident.provisional_cause).toBe("Fuite de connexions DB");
    expect(restored.body.incident.restoration_proof).toBeTruthy();

    const closeWithoutSummary = await request(app).post(`/api/operations/incidents/${id}/close`).set("x-test-role", "admin").send({});
    expect(closeWithoutSummary.status).toBe(400);

    const closed = await request(app).post(`/api/operations/incidents/${id}/close`).set("x-test-role", "admin")
      .send({ closureSummary: "Correctif déployé, surveillance 24h sans récidive" });
    expect(closed.status).toBe(200);
    expect(closed.body.incident.status).toBe("closed");
    expect(closed.body.incident.closed_at).toBeTruthy();

    // Un incident fermé est un état terminal : toute nouvelle transition est refusée.
    const containAfterClose = await request(app).post(`/api/operations/incidents/${id}/contain`).set("x-test-role", "admin");
    expect(containAfterClose.status).toBe(409);
  });

  test("action inconnue et incident introuvable renvoient une erreur explicite", async () => {
    const created = await request(app).post("/api/operations/incidents").set("x-test-role", "manager")
      .send({
        title: "Test action inconnue",
        description: "Test",
        severity: "low",
        impactSummary: "Aucun",
        serviceKey: "svc-test",
        idempotencyKey: "inc-e2e-unknown-0001",
      });
    const id = created.body.incident.id;

    const unknownAction = await request(app).post(`/api/operations/incidents/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const notFound = await request(app).post("/api/operations/incidents/999999999/contain").set("x-test-role", "admin");
    expect(notFound.status).toBe(404);
  });

  test("filtre par statut et par gravité", async () => {
    const bySeverity = await request(app).get("/api/operations/incidents").query({ severity: "critical" }).set("x-test-role", "admin");
    expect(bySeverity.status).toBe(200);
    expect(bySeverity.body.incidents.every((incident) => incident.severity === "critical")).toBe(true);

    const byStatus = await request(app).get("/api/operations/incidents").query({ status: "closed" }).set("x-test-role", "admin");
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.incidents.every((incident) => incident.status === "closed")).toBe(true);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Operational Incidents E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/operations/incidents").set("x-test-role", "admin");
      expect(list.body.incidents).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
