// Suite de #698-style : hr-complete-block.service.js (transitionReview,
// evaluateReviewClosure) et la table hr_performance_reviews existaient sans
// jamais être montés sur aucune route (grep exhaustif avant d'écrire ce
// fichier : aucun appelant hors du service lui-même et de son test de
// contrat, qui ne vérifie que l'existence des fichiers/migrations, jamais
// un vrai parcours HTTP+DB). Ce test exécute le cycle de vie complet d'une
// évaluation par de vraies requêtes HTTP contre une vraie base : brouillon
// -> saisie employé -> révision gestionnaire -> accusé de réception ->
// fermeture, garde-fou de fermeture (note + objectifs + compétences
// requis), transitions invalides, idempotence et isolation
// multi-organisation.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

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

const hrRoutes = require("../routes/business/hr.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/hr", hrRoutes);
  return app;
}

async function seedEmployee(organisationId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO hr_employees (organisation_id, employee_number, legal_name) VALUES ($1,$2,'Employé Test') RETURNING *`,
    [organisationId, `E-REVIEW-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Évaluations de performance RH (suite #698)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("cycle de vie complet : brouillon -> saisie employé -> révision -> accusé -> fermeture", async () => {
    const org = await createTestOrganisation({ nom: "HR Performance Review E2E Lifecycle" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "lifecycle");

    const created = await request(app)
      .post("/api/hr/performance-reviews")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, periodStart: "2026-01-01", periodEnd: "2026-06-30", idempotencyKey: "review-create-0001" });
    expect(created.status).toBe(201);
    expect(created.body.review.status).toBe("draft");
    const reviewId = created.body.review.id;

    const listed = await request(app)
      .get(`/api/hr/performance-reviews?employeeId=${employee.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(listed.status).toBe(200);
    expect(listed.body.reviews).toHaveLength(1);

    // Une évaluation en brouillon ne peut pas sauter directement à "closed".
    const invalidJump = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-invalid-jump-0001" });
    expect(invalidJump.status).toBe(409);

    const toEmployeeInput = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/employee_input`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeComments: "Mes réalisations du semestre.", idempotencyKey: "review-transition-0001" });
    expect(toEmployeeInput.status).toBe(201);
    expect(toEmployeeInput.body.review.status).toBe("employee_input");
    expect(toEmployeeInput.body.review.employee_comments).toBe("Mes réalisations du semestre.");

    const toManagerReview = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/manager_review`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ managerComments: "Bon semestre.", idempotencyKey: "review-transition-0002" });
    expect(toManagerReview.status).toBe(201);
    expect(toManagerReview.body.review.status).toBe("manager_review");

    // La fermeture exige une note + au moins un objectif + une compétence : refusée tant qu'absents.
    const acknowledged = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/acknowledged`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-transition-0003" });
    expect(acknowledged.status).toBe(201); // acknowledged n'exige pas la fermeture complète
    expect(acknowledged.body.review.acknowledged_at).toBeTruthy();

    const closeIncomplete = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-transition-0004" });
    expect(closeIncomplete.status).toBe(409);

    const closed = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({
        overallRating: 4.5,
        objectives: [{ title: "Livrer le projet X", achieved: true }],
        competencies: [{ code: "COMM", rating: 4 }],
        idempotencyKey: "review-transition-0005",
      });
    expect(closed.status).toBe(201);
    expect(closed.body.review.status).toBe("closed");
    expect(closed.body.review.closed_at).toBeTruthy();
    expect(Number(closed.body.review.overall_rating)).toBe(4.5);

    // Historique des transitions consultable.
    const fetched = await request(app)
      .get(`/api/hr/performance-reviews/${reviewId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(fetched.body.transitions.length).toBeGreaterThanOrEqual(4);

    // Une évaluation fermée n'accepte plus aucune transition.
    const afterClosed = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/cancelled`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-transition-0006" });
    expect(afterClosed.status).toBe(409);
  });

  test("idempotence : rejouer la même clé de transition ne modifie rien de plus", async () => {
    const org = await createTestOrganisation({ nom: "HR Performance Review E2E Idempotency" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "idempotency");

    const created = await request(app)
      .post("/api/hr/performance-reviews")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, periodStart: "2026-01-01", periodEnd: "2026-06-30", idempotencyKey: "review-idem-create-0001" });
    const reviewId = created.body.review.id;

    const first = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/employee_input`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-idem-transition-0001" });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/employee_input`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-idem-transition-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    const history = await db.pool.query("SELECT * FROM hr_performance_review_transitions WHERE organisation_id=$1 AND review_id=$2", [org.id, reviewId]);
    expect(history.rows).toHaveLength(1);
  });

  test("création refusée pour un employé introuvable", async () => {
    const org = await createTestOrganisation({ nom: "HR Performance Review E2E Missing Employee" });
    mockState.organisationId = org.id;

    const attempt = await request(app)
      .post("/api/hr/performance-reviews")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: 999999999, periodStart: "2026-01-01", periodEnd: "2026-06-30", idempotencyKey: "review-missing-employee-0001" });
    expect(attempt.status).toBe(404);
  });

  test("isolation stricte : une évaluation d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "HR Performance Review E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "HR Performance Review E2E Org B" });

    mockState.organisationId = orgA.id;
    const employeeA = await seedEmployee(orgA.id, "iso-a");
    const created = await request(app)
      .post("/api/hr/performance-reviews")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employeeA.id, periodStart: "2026-01-01", periodEnd: "2026-06-30", idempotencyKey: "review-iso-create-0001" });
    const reviewId = created.body.review.id;

    mockState.organisationId = orgB.id;
    const crossOrgGet = await request(app)
      .get(`/api/hr/performance-reviews/${reviewId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(crossOrgGet.status).toBe(404);

    const crossOrgTransition = await request(app)
      .post(`/api/hr/performance-reviews/${reviewId}/transitions/employee_input`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "review-iso-transition-0001" });
    expect(crossOrgTransition.status).toBe(404);
  });
});
