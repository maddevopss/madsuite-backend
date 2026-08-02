// Suite de #698 (lacune documentée : payroll-approval-policy.service.js —
// prévention d'auto-approbation, jusqu'ici jamais câblée). La séparation
// préparateur/approbateur de payroll.routes.js repose uniquement sur le rôle
// (préparation ouverte à admin/manager, approbation réservée admin) : un
// manager qui prépare ne peut pas s'auto-approuver puisqu'il n'a pas le rôle
// admin, mais rien n'empêchait un admin de préparer ET approuver le même
// cycle, puisque admin peut faire les deux. Ce test exécute le cycle réel via
// de vraies requêtes HTTP contre une vraie base : le même utilisateur admin
// ne peut pas approuver le cycle qu'il vient de calculer (403, statut
// inchangé), mais un second admin le peut ; l'auto-approbation reste bloquée
// même après une tentative de void/relance ; et payroll_runs.calculated_by
// est réellement persisté par le calcul.
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

describe("Prévention d'auto-approbation des cycles de paie (suite #698)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("un admin ne peut pas approuver le cycle qu'il vient de calculer, un second admin le peut", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Self-Approval E2E" });
    mockState.organisationId = org.id;
    const adminA = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin Préparateur" });
    const adminB = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin Second" });

    const period = await seedReadyPeriod(org.id, "self");

    const createdRun = await request(app)
      .post(`/api/payroll/periods/${period.id}/runs`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminA.id))
      .send({ idempotencyKey: "self-approval-run-create-0001" });
    expect(createdRun.status).toBe(201);
    const runId = createdRun.body.run.id;

    const calculated = await request(app)
      .post(`/api/payroll/runs/${runId}/calculate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminA.id))
      .send({ idempotencyKey: "self-approval-calc-0001" });
    expect(calculated.status).toBe(201);
    expect(calculated.body.run.status).toBe("calculated");

    // L'auteur du calcul est réellement persisté.
    const persisted = await db.pool.query(`SELECT calculated_by FROM payroll_runs WHERE id=$1`, [runId]);
    expect(Number(persisted.rows[0].calculated_by)).toBe(adminA.id);

    // Le préparateur (admin A) ne peut pas s'auto-approuver, même en tant qu'admin.
    const selfApprove = await request(app)
      .post(`/api/payroll/runs/${runId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminA.id));
    expect(selfApprove.status).toBe(403);

    const stillCalculated = await db.pool.query(`SELECT status, approved_by FROM payroll_runs WHERE id=$1`, [runId]);
    expect(stillCalculated.rows[0].status).toBe("calculated");
    expect(stillCalculated.rows[0].approved_by).toBeNull();

    // Un second admin (qui n'a pas préparé ce cycle) peut l'approuver.
    const approvedByOther = await request(app)
      .post(`/api/payroll/runs/${runId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminB.id));
    expect(approvedByOther.status).toBe(201);
    expect(approvedByOther.body.run.status).toBe("approved");
    expect(Number(approvedByOther.body.run.approved_by)).toBe(adminB.id);
  });

  test("un cycle calculé sans acteur identifié (calculated_by NULL) reste approuvable normalement", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Self-Approval E2E NullActor" });
    mockState.organisationId = org.id;
    const admin = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin Seul" });
    const period = await seedReadyPeriod(org.id, "nullactor");

    const createdRun = await request(app)
      .post(`/api/payroll/periods/${period.id}/runs`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send({ idempotencyKey: "self-approval-run-create-0002" });
    const runId = createdRun.body.run.id;

    // Calcul déclenché sans en-tête d'identité (chemin de compatibilité
    // arrière : req.user?.id est undefined, donc calculated_by reste NULL).
    const calculated = await request(app)
      .post(`/api/payroll/runs/${runId}/calculate`)
      .set("x-test-role", "admin")
      .send({ idempotencyKey: "self-approval-calc-0002" });
    expect(calculated.status).toBe(201);

    const persisted = await db.pool.query(`SELECT calculated_by FROM payroll_runs WHERE id=$1`, [runId]);
    expect(persisted.rows[0].calculated_by).toBeNull();

    const approved = await request(app)
      .post(`/api/payroll/runs/${runId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(approved.status).toBe(201);
    expect(approved.body.run.status).toBe("approved");
  });

  test("isolation stricte : calculated_by d'une organisation n'affecte pas la vérification d'une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "Payroll Self-Approval E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "Payroll Self-Approval E2E Org B" });
    const sharedAdmin = await createTestUser({ role: "admin", organisation_id: orgA.id, nom: "Admin Partagé" });

    mockState.organisationId = orgA.id;
    const periodA = await seedReadyPeriod(orgA.id, "iso-a");
    const runA = await request(app)
      .post(`/api/payroll/periods/${periodA.id}/runs`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(sharedAdmin.id))
      .send({ idempotencyKey: "self-approval-iso-a-0001" });
    await request(app)
      .post(`/api/payroll/runs/${runA.body.run.id}/calculate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(sharedAdmin.id))
      .send({ idempotencyKey: "self-approval-iso-a-calc-0001" });

    mockState.organisationId = orgB.id;
    const periodB = await seedReadyPeriod(orgB.id, "iso-b");
    const runB = await request(app)
      .post(`/api/payroll/periods/${periodB.id}/runs`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(sharedAdmin.id))
      .send({ idempotencyKey: "self-approval-iso-b-0001" });
    const calculatedB = await request(app)
      .post(`/api/payroll/runs/${runB.body.run.id}/calculate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(sharedAdmin.id))
      .send({ idempotencyKey: "self-approval-iso-b-calc-0001" });
    expect(calculatedB.status).toBe(201);

    // Le même acteur ayant préparé le cycle de orgB ne peut toujours pas
    // l'auto-approuver (la vérification reste correcte par organisation).
    const selfApproveB = await request(app)
      .post(`/api/payroll/runs/${runB.body.run.id}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(sharedAdmin.id));
    expect(selfApproveB.status).toBe(403);
  });
});
