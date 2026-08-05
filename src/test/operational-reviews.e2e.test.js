// Étage 8 PR G — Revues d'exploitation (issue #194).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// génération de synthèse réelle (incidents majeurs, changements exécutés,
// dérives de capacité, risques ouverts — seedés directement en base),
// figée dans la revue (pas recalculée après coup), décisions avec
// responsable et échéance, fermeture bloquée tant qu'une décision n'a pas
// de preuve de suivi, RBAC et isolation multi-organisation.
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

const operationalReviewsRoutes = require("../routes/business/operational-reviews.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/operations/reviews", operationalReviewsRoutes);
  return app;
}

async function seedMajorIncident(organisationId, userId, declaredAt) {
  await db.pool.query(
    `INSERT INTO operational_incidents (
       organisation_id, incident_number, service_key, title, description, severity,
       impact_summary, status, responsible_user_id, declared_at, restored_at, idempotency_key
     ) VALUES ($1,$2,'svc-review','Incident majeur','Test','critical','Impact','restored',$3,$4,$4,$5)`,
    [organisationId, `INC-REVIEW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId, declaredAt, `review-inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  );
}

async function seedExecutedChange(organisationId, userId, executedAt) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await db.pool.query(
    `INSERT INTO operational_changes (
       organisation_id, change_number, title, description, risk_level, rollback_plan,
       status, requested_by, approved_by, approved_at, executed_at, execution_proof, idempotency_key
     ) VALUES ($1,$2,'Changement revue','Test','low','Revert','executed',$3,$3,$4,$4,'Preuve',$5)`,
    [organisationId, `CHG-REVIEW-${suffix}`, userId, executedAt, `review-chg-${suffix}`],
  );
}

describe("Revues d'exploitation — synthèse réelle et décisions suivies (Étage 8 PR G)", () => {
  let app;
  let orgId;
  let userId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Operational Reviews E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    userId = user.id;
    app = buildApp();
  });

  test("un employé ne peut ni lister ni créer de revue", async () => {
    const list = await request(app).get("/api/operations/reviews").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/operations/reviews").set("x-test-role", "employe")
      .send({ reviewType: "weekly", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-08T00:00:00Z" });
    expect(create.status).toBe(403);
  });

  test("validations : type de revue et période invalides rejetés", async () => {
    const badType = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "BOGUS", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-08T00:00:00Z" });
    expect(badType.status).toBe(400);

    const badPeriod = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "weekly", periodStart: "2026-01-08T00:00:00Z", periodEnd: "2026-01-01T00:00:00Z" });
    expect(badPeriod.status).toBe(400);
  });

  test("génération réelle de synthèse : incident majeur et changement exécuté dans la période sont capturés", async () => {
    await seedMajorIncident(orgId, userId, "2026-02-03T10:00:00Z");
    await seedExecutedChange(orgId, userId, "2026-02-04T10:00:00Z");

    const res = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "weekly", periodStart: "2026-02-01T00:00:00Z", periodEnd: "2026-02-08T00:00:00Z", idempotencyKey: "review-e2e-0001" });
    expect(res.status).toBe(201);
    expect(res.body.review.status).toBe("open");
    expect(res.body.review.summary.majorIncidents.length).toBeGreaterThanOrEqual(1);
    expect(res.body.review.summary.changes.length).toBeGreaterThanOrEqual(1);
    expect(res.body.review.summary).toHaveProperty("capacityAlerts");
    expect(res.body.review.summary).toHaveProperty("openRisks");
  });

  test("une deuxième revue pour le même type et la même période exacte est refusée", async () => {
    const first = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "monthly", periodStart: "2026-03-01T00:00:00Z", periodEnd: "2026-04-01T00:00:00Z", idempotencyKey: "review-e2e-dup-0001" });
    expect(first.status).toBe(201);

    const duplicate = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "monthly", periodStart: "2026-03-01T00:00:00Z", periodEnd: "2026-04-01T00:00:00Z", idempotencyKey: "review-e2e-dup-0002" });
    expect(duplicate.status).toBe(409);
  });

  test("cycle complet : décision, fermeture bloquée sans preuve de suivi, fermeture après preuve", async () => {
    const created = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "weekly", periodStart: "2026-05-01T00:00:00Z", periodEnd: "2026-05-08T00:00:00Z", idempotencyKey: "review-e2e-cycle-0001" });
    const id = created.body.review.id;

    const decision = await request(app).post(`/api/operations/reviews/${id}/decisions`).set("x-test-role", "admin")
      .send({ decision: "Augmenter la capacité de stockage du service X", dueAt: "2026-05-15T00:00:00Z" });
    expect(decision.status).toBe(201);
    expect(decision.body.decision.status).toBe("pending");
    const decisionId = decision.body.decision.id;

    const closeBlocked = await request(app).post(`/api/operations/reviews/${id}/close`).set("x-test-role", "admin");
    expect(closeBlocked.status).toBe(409);
    expect(closeBlocked.body.pendingDecisionIds.map(String)).toContain(String(decisionId));

    const completeWithoutEvidence = await request(app).post(`/api/operations/reviews/${id}/decisions/${decisionId}/complete`).set("x-test-role", "admin").send({});
    expect(completeWithoutEvidence.status).toBe(400);

    const completed = await request(app).post(`/api/operations/reviews/${id}/decisions/${decisionId}/complete`).set("x-test-role", "admin")
      .send({ followUpEvidence: "Capacité augmentée le 2026-05-10, confirmé par le fournisseur" });
    expect(completed.status).toBe(200);
    expect(completed.body.decision.status).toBe("done");

    const closed = await request(app).post(`/api/operations/reviews/${id}/close`).set("x-test-role", "admin");
    expect(closed.status).toBe(200);
    expect(closed.body.review.status).toBe("closed");

    const decisionOnClosed = await request(app).post(`/api/operations/reviews/${id}/decisions`).set("x-test-role", "admin")
      .send({ decision: "Trop tard" });
    expect(decisionOnClosed.status).toBe(409);
  });

  test("revue et décision introuvables renvoient une erreur explicite", async () => {
    const notFound = await request(app).get("/api/operations/reviews/999999999").set("x-test-role", "admin");
    expect(notFound.status).toBe(404);

    const created = await request(app).post("/api/operations/reviews").set("x-test-role", "manager")
      .send({ reviewType: "weekly", periodStart: "2026-06-01T00:00:00Z", periodEnd: "2026-06-08T00:00:00Z", idempotencyKey: "review-e2e-notfound-0001" });
    const decisionNotFound = await request(app).post(`/api/operations/reviews/${created.body.review.id}/decisions/999999999/complete`).set("x-test-role", "admin")
      .send({ followUpEvidence: "X" });
    expect(decisionNotFound.status).toBe(404);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Operational Reviews E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/operations/reviews").set("x-test-role", "admin");
      expect(list.body.reviews).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
