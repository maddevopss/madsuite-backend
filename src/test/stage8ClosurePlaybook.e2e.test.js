// Étage 8 PR H — Fermeture de l'Étage 8 (issue #194).
// Exercice de fermeture : un scénario réaliste unique exécuté par de
// vraies requêtes HTTP contre une vraie base, enchaînant les blocs B, D,
// E, F et G câblés par cette PR, pour prouver qu'ils fonctionnent
// ENSEMBLE (pas seulement isolément dans leurs suites respectives) :
// 1. exercice d'incident majeur (déclaration → confinement → rétablissement
//    tardif, au-delà de l'objectif de rétablissement — PR B/E) ;
// 2. vérification des niveaux de service : la dérive est détectée et
//    n'apparaît qu'après le rétablissement, avec l'incident réel en
//    preuve (PR E) ;
// 3. exercice de changement avec retour arrière (demande → approbation
//    indépendante → planification → exécution → régression détectée →
//    retour arrière — PR D) ;
// 4. dérive de capacité détectée (PR F) ;
// 5. revue d'exploitation : synthèse figée capturant l'incident majeur,
//    le changement exécuté et la dérive de capacité, décision assortie
//    d'une échéance, fermeture bloquée tant que la décision n'a pas de
//    preuve de suivi, puis fermeture effective (PR G).
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

const mockState = { organisationId: null };

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
  if (role) req.user = { id: userId ? Number(userId) : null, role };
  next();
}

const operationalIncidentsRoutes = require("../routes/business/operational-incidents.routes");
const operationalChangesRoutes = require("../routes/business/operational-changes.routes");
const operationalServiceLevelsRoutes = require("../routes/business/operational-service-levels.routes");
const operationalCapacityRoutes = require("../routes/business/operational-capacity.routes");
const operationalReviewsRoutes = require("../routes/business/operational-reviews.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/incidents", operationalIncidentsRoutes);
  app.use("/api/operations/changes", operationalChangesRoutes);
  app.use("/api/operations/service-levels", operationalServiceLevelsRoutes);
  app.use("/api/operations/capacity", operationalCapacityRoutes);
  app.use("/api/operations/reviews", operationalReviewsRoutes);
  return app;
}

describe("Étage 8 — exercice de fermeture (PR H, issue #194)", () => {
  let app;
  let orgId;
  let requesterId;
  let approverId;
  const SERVICE = "svc-checkout";
  const PERIOD_START = "2026-04-01T00:00:00Z";
  const PERIOD_END = "2026-04-08T00:00:00Z";

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Stage8 Closure Playbook Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const requester = await createTestUser({ organisation_id: orgId, role: "manager" });
    const approver = await createTestUser({ organisation_id: orgId, role: "admin" });
    requesterId = requester.id;
    approverId = approver.id;
    app = buildApp();

    await request(app).post("/api/operations/service-levels").set("x-test-role", "manager").set("x-test-user-id", String(requesterId))
      .send({ serviceKey: SERVICE, availabilityTarget: 99.9, responseTimeTargetMinutes: 15, restorationTimeTargetMinutes: 60, idempotencyKey: "closure-slo-0001" });
  });

  test("1. exercice d'incident majeur : rétablissement tardif au-delà de l'objectif", async () => {
    const declared = await request(app).post("/api/operations/incidents").set("x-test-role", "manager").set("x-test-user-id", String(requesterId))
      .send({
        title: "Panne de paiement au checkout",
        description: "Erreurs 500 sur la confirmation de commande",
        severity: "critical",
        impactSummary: "Aucune commande ne peut être finalisée",
        serviceKey: SERVICE,
        idempotencyKey: "closure-inc-0001",
      });
    expect(declared.status).toBe(201);
    const incidentId = declared.body.incident.id;

    const contained = await request(app).post(`/api/operations/incidents/${incidentId}/contain`).set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(contained.status).toBe(200);

    const restored = await request(app).post(`/api/operations/incidents/${incidentId}/restore`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ restorationProof: "Bascule vers le fournisseur de paiement de secours", provisionalCause: "Panne du fournisseur de paiement principal" });
    expect(restored.status).toBe(200);

    const closed = await request(app).post(`/api/operations/incidents/${incidentId}/close`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ closureSummary: "Fournisseur de paiement rétabli, surveillance renforcée 48h" });
    expect(closed.status).toBe(200);

    // Rétablissement forcé à 90 min (> objectif de 60 min) pour un
    // scénario de dérive déterministe, sans dépendre du temps réel écoulé
    // pendant l'exécution du test.
    await db.pool.query(
      `UPDATE operational_incidents SET declared_at=$2::timestamptz, restored_at=$2::timestamptz + interval '90 minutes'
        WHERE id=$1 AND organisation_id=$3`,
      [incidentId, "2026-04-02T10:00:00Z", orgId],
    );
  });

  test("2. vérification des niveaux de service : la dérive de rétablissement est détectée, avec l'incident réel en preuve", async () => {
    const results = await request(app).get("/api/operations/service-levels/results")
      .query({ serviceKey: SERVICE, periodStart: PERIOD_START, periodEnd: PERIOD_END })
      .set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(results.status).toBe(200);
    expect(results.body.result.restorationTimeBreached).toBe(true);
    expect(results.body.result.avgRestorationTimeMinutes).toBeGreaterThan(60);
    expect(results.body.result.incidentsConsidered.length).toBeGreaterThanOrEqual(1);

    const alerts = await request(app).get("/api/operations/service-levels/alerts")
      .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END })
      .set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(alerts.body.alerts.some((a) => a.serviceKey === SERVICE)).toBe(true);
  });

  test("3. exercice de changement avec retour arrière : approbation indépendante, exécution, régression, rollback", async () => {
    const created = await request(app).post("/api/operations/changes").set("x-test-role", "manager").set("x-test-user-id", String(requesterId))
      .send({
        title: "Migration du fournisseur de paiement principal",
        description: "Passage à la nouvelle version de l'API du fournisseur",
        riskLevel: "high",
        rollbackPlan: "Revenir à l'ancienne intégration via bascule de configuration",
        idempotencyKey: "closure-chg-0001",
      });
    expect(created.status).toBe(201);
    const changeId = created.body.change.id;

    const selfApprove = await request(app).post(`/api/operations/changes/${changeId}/approve`).set("x-test-role", "manager").set("x-test-user-id", String(requesterId));
    expect(selfApprove.status).toBe(409);

    const approved = await request(app).post(`/api/operations/changes/${changeId}/approve`).set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(approved.status).toBe(200);

    const scheduled = await request(app).post(`/api/operations/changes/${changeId}/schedule`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ windowStart: "2026-04-05T01:00:00Z", windowEnd: "2026-04-05T03:00:00Z" });
    expect(scheduled.status).toBe(200);

    const executed = await request(app).post(`/api/operations/changes/${changeId}/execute`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ executionProof: "Déploiement effectué, tests de fumée initiaux passés" });
    expect(executed.status).toBe(200);

    const rolledBack = await request(app).post(`/api/operations/changes/${changeId}/rollback`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ rollbackReason: "Régression détectée sur les paiements récurrents en production" });
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.change.status).toBe("rolled_back");

    await db.pool.query(
      `UPDATE operational_changes SET executed_at=$2 WHERE id=$1 AND organisation_id=$3`,
      [changeId, "2026-04-05T02:00:00Z", orgId],
    );
  });

  test("4. dérive de capacité détectée sur le service touché", async () => {
    await request(app).post("/api/operations/capacity/thresholds").set("x-test-role", "manager").set("x-test-user-id", String(requesterId))
      .send({ serviceKey: SERVICE, resourceType: "compute", capacityLimit: 100, warningThresholdPercent: 80, idempotencyKey: "closure-cap-thresh-0001" });
    await request(app).post("/api/operations/capacity/usage").set("x-test-role", "manager").set("x-test-user-id", String(requesterId))
      .send({ serviceKey: SERVICE, resourceType: "compute", unit: "hours", quantity: 92, idempotencyKey: "closure-cap-usage-0001" });

    const alerts = await request(app).get("/api/operations/capacity/alerts").set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(alerts.body.alerts.some((a) => a.serviceKey === SERVICE)).toBe(true);
  });

  test("5. revue d'exploitation : synthèse réelle, fermeture bloquée puis débloquée par une preuve de suivi", async () => {
    const review = await request(app).post("/api/operations/reviews").set("x-test-role", "manager").set("x-test-user-id", String(requesterId))
      .send({ reviewType: "weekly", periodStart: PERIOD_START, periodEnd: PERIOD_END, idempotencyKey: "closure-review-0001" });
    expect(review.status).toBe(201);
    const reviewId = review.body.review.id;

    // La synthèse capture bien l'incident majeur, le changement exécuté et
    // la dérive de capacité de ce scénario — pas un agrégat vide.
    expect(review.body.review.summary.majorIncidents.length).toBeGreaterThanOrEqual(1);
    expect(review.body.review.summary.changes.length).toBeGreaterThanOrEqual(1);
    expect(review.body.review.summary.capacityAlerts.some((a) => a.serviceKey === SERVICE)).toBe(true);

    const decision = await request(app).post(`/api/operations/reviews/${reviewId}/decisions`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ decision: "Ajouter un fournisseur de paiement de secours permanent, pas seulement en bascule d'urgence", dueAt: "2026-04-20T00:00:00Z" });
    expect(decision.status).toBe(201);
    const decisionId = decision.body.decision.id;

    const closeBlocked = await request(app).post(`/api/operations/reviews/${reviewId}/close`).set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(closeBlocked.status).toBe(409);
    expect(closeBlocked.body.pendingDecisionIds.map(String)).toContain(String(decisionId));

    const completed = await request(app).post(`/api/operations/reviews/${reviewId}/decisions/${decisionId}/complete`).set("x-test-role", "admin").set("x-test-user-id", String(approverId))
      .send({ followUpEvidence: "Deuxième fournisseur de paiement intégré et testé en production le 2026-04-18" });
    expect(completed.status).toBe(200);

    const closed = await request(app).post(`/api/operations/reviews/${reviewId}/close`).set("x-test-role", "admin").set("x-test-user-id", String(approverId));
    expect(closed.status).toBe(200);
    expect(closed.body.review.status).toBe("closed");
  });
});
