// Suite de #698 (lacune documentée : workflow multi-approbateurs — tables
// payroll_approval_policies/payroll_approval_steps déjà migrées et
// evaluateApproval (payroll-approval.service.js) déjà écrit, mais jamais
// exploités par aucune route). Ce test exécute par de vraies requêtes HTTP
// contre une vraie base : par défaut (aucune politique configurée), le
// comportement à un seul approbateur reste inchangé ; une fois une politique
// activée (minimumApprovers=2), l'approbation directe à un seul appel est
// refusée, chaque décision est enregistrée, l'auto-approbation du
// préparateur reste bloquée même sous ce régime, le cycle ne bascule
// "approved" qu'une fois le seuil de décisions distinctes "approved"
// atteint, et une décision "rejected" n'avance pas le seuil.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");
const { activateRuleset, checksumRules } = require("../services/business/payroll-run-lifecycle.service");

jest.mock("../services/business/trust-persistence.service", () => ({
  persistTrustAssessment: jest.fn().mockResolvedValue({ assessmentId: 1 }),
  persistGraphEdges: jest.fn().mockResolvedValue({}),
}));

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

const payrollRoutes = require("../routes/business/payroll.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/payroll", payrollRoutes);
  return app;
}

const RULES = {
  payPeriodsPerYear: 26,
  overtimeMultiplier: 1.5,
  employeeDeductions: { RRQ: 0.054, AE: 0.0132 },
  employerContributions: { RRQ: 0.054, AE: 0.0185 },
  voluntaryDeductions: {},
};

async function seedReadyPeriod(organisationId, suffix) {
  const checksum = checksumRules(RULES);
  const ruleset = await db.pool.query(
    `INSERT INTO payroll_rulesets (organisation_id, version, province, effective_from, rules, checksum, status)
     VALUES ($1,$2,'QC','2026-01-01',$3,$4,'draft') RETURNING *`,
    [organisationId, `v-${suffix}`, JSON.stringify(RULES), checksum],
  );
  await activateRuleset(db.pool, organisationId, ruleset.rows[0].id, null);

  const employee = await db.pool.query(
    `INSERT INTO payroll_employees
      (organisation_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate)
     VALUES ($1,$2,'Test Employee','Test','Employee','2020-01-01','hourly',25) RETURNING *`,
    [organisationId, `E-${suffix}-${Date.now()}`],
  );

  const period = await db.pool.query(
    `INSERT INTO payroll_periods (organisation_id, frequency, period_start, period_end, pay_date)
     VALUES ($1,'biweekly','2026-07-01','2026-07-14','2026-07-18') RETURNING *`,
    [organisationId],
  );

  await db.pool.query(
    `INSERT INTO payroll_variable_inputs (organisation_id, payroll_period_id, employee_id, input_type, quantity, source_type, source_id)
     VALUES ($1,$2,$3,'regular_hours',70,'manual','test')`,
    [organisationId, period.rows[0].id, employee.rows[0].id],
  );

  return period.rows[0];
}

async function createCalculatedRun(app, organisationId, preparerId, suffix) {
  const period = await seedReadyPeriod(organisationId, suffix);
  const createdRun = await request(app)
    .post(`/api/payroll/periods/${period.id}/runs`)
    .set("x-test-role", "admin")
    .set("x-test-user-id", String(preparerId))
    .send({ idempotencyKey: `multi-approver-run-create-${suffix}` });
  const runId = createdRun.body.run.id;
  await request(app)
    .post(`/api/payroll/runs/${runId}/calculate`)
    .set("x-test-role", "admin")
    .set("x-test-user-id", String(preparerId))
    .send({ idempotencyKey: `multi-approver-calc-${suffix}` });
  return runId;
}

describe("Workflow multi-approbateurs de paie (suite #698)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("sans politique active, le comportement à un seul approbateur reste inchangé", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Multi-Approver E2E Default" });
    mockState.organisationId = org.id;
    const preparer = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Préparateur" });
    const approver = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Approbateur" });
    const runId = await createCalculatedRun(app, org.id, preparer.id, "default");

    const decisionAttempt = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approver.id))
      .send({ decision: "approved" });
    expect(decisionAttempt.status).toBe(409);

    const directApprove = await request(app)
      .post(`/api/payroll/runs/${runId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approver.id));
    expect(directApprove.status).toBe(201);
    expect(directApprove.body.run.status).toBe("approved");
  });

  test("politique active (2 approbateurs) : approbation directe refusée, seuil requis, auto-approbation toujours bloquée", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Multi-Approver E2E Active" });
    mockState.organisationId = org.id;
    const preparer = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Préparateur" });
    const approverA = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Approbateur A" });
    const approverB = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Approbateur B" });

    const setPolicy = await request(app)
      .post("/api/payroll/approval-policy")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(preparer.id))
      .send({ minimumApprovers: 2, prohibitSelfApproval: true, active: true });
    expect(setPolicy.status).toBe(201);
    expect(setPolicy.body.policy.minimum_approvers).toBe(2);

    const runId = await createCalculatedRun(app, org.id, preparer.id, "active");

    // L'approbation directe à un seul appel est désormais refusée pour ce cycle.
    const directApprove = await request(app)
      .post(`/api/payroll/runs/${runId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverA.id));
    expect(directApprove.status).toBe(409);

    // Le préparateur ne peut pas enregistrer une décision "approved" pour son propre cycle.
    const selfDecision = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(preparer.id))
      .send({ decision: "approved" });
    expect(selfDecision.status).toBe(403);

    // Première décision distincte : le seuil n'est pas encore atteint, le cycle reste "calculated".
    const firstDecision = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverA.id))
      .send({ decision: "approved" });
    expect(firstDecision.status).toBe(200);
    expect(firstDecision.body.evaluation.ready).toBe(false);
    expect(firstDecision.body.evaluation.approvedCount).toBe(1);

    const stillCalculated = await db.pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId]);
    expect(stillCalculated.rows[0].status).toBe("calculated");

    // La même personne qui redécide (même decidedBy) ne fait pas progresser le compte d'approbateurs distincts.
    const duplicateDecision = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverA.id))
      .send({ decision: "approved" });
    expect(duplicateDecision.status).toBe(200);
    expect(duplicateDecision.body.evaluation.approvedCount).toBe(1);

    // Deuxième approbateur distinct : le seuil est atteint, le cycle bascule "approved".
    const secondDecision = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverB.id))
      .send({ decision: "approved" });
    expect(secondDecision.status).toBe(201);
    expect(secondDecision.body.evaluation.ready).toBe(true);
    expect(secondDecision.body.run.status).toBe("approved");

    const finalRun = await db.pool.query(`SELECT status, approved_by FROM payroll_runs WHERE id=$1`, [runId]);
    expect(finalRun.rows[0].status).toBe("approved");
    expect(Number(finalRun.rows[0].approved_by)).toBe(approverB.id);

    // Une tentative de décision après approbation effective est refusée.
    const lateDecision = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverA.id))
      .send({ decision: "approved" });
    expect(lateDecision.status).toBe(409);

    const listed = await request(app)
      .get(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverA.id));
    expect(listed.status).toBe(200);
    expect(listed.body.decisions).toHaveLength(2);
  });

  test("une décision 'rejected' est enregistrée mais ne fait pas avancer le seuil", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Multi-Approver E2E Rejected" });
    mockState.organisationId = org.id;
    const preparer = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Préparateur" });
    const approverA = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Approbateur A" });

    await request(app)
      .post("/api/payroll/approval-policy")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(preparer.id))
      .send({ minimumApprovers: 2, prohibitSelfApproval: true, active: true });

    const runId = await createCalculatedRun(app, org.id, preparer.id, "rejected");

    const rejected = await request(app)
      .post(`/api/payroll/runs/${runId}/approval-decisions`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverA.id))
      .send({ decision: "rejected", reason: "Écart non justifié" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.evaluation.ready).toBe(false);
    expect(rejected.body.evaluation.approvedCount).toBe(0);

    const stillCalculated = await db.pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId]);
    expect(stillCalculated.rows[0].status).toBe("calculated");
  });

  test("isolation stricte : une politique active dans une organisation n'affecte pas une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "Payroll Multi-Approver E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "Payroll Multi-Approver E2E Org B" });
    const preparerA = await createTestUser({ role: "admin", organisation_id: orgA.id, nom: "Préparateur A" });
    const preparerB = await createTestUser({ role: "admin", organisation_id: orgB.id, nom: "Préparateur B" });
    const approverB = await createTestUser({ role: "admin", organisation_id: orgB.id, nom: "Approbateur B" });

    mockState.organisationId = orgA.id;
    await request(app)
      .post("/api/payroll/approval-policy")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(preparerA.id))
      .send({ minimumApprovers: 2, active: true });

    mockState.organisationId = orgB.id;
    const runIdB = await createCalculatedRun(app, orgB.id, preparerB.id, "iso-b");

    // orgB n'a jamais configuré de politique : approbation directe classique.
    const directApproveB = await request(app)
      .post(`/api/payroll/runs/${runIdB}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverB.id));
    expect(directApproveB.status).toBe(201);
    expect(directApproveB.body.run.status).toBe("approved");

    const policyB = await request(app)
      .get("/api/payroll/approval-policy")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(approverB.id));
    expect(policyB.body.policy).toBeNull();
  });
});
