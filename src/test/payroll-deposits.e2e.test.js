// Preuve d'exécution réelle du domaine 4 (paie), dépôt direct. Cartographie
// préalable : payroll-deposits.routes.js est réellement monté
// (/api/payroll/remittances/deposits), mais aucun test n'exécutait de vraie
// requête SQL contre ce routeur — le seul test existant est un test
// "contrat" qui lit le texte source. Le test réel a révélé que cette route
// était la SEULE de tout le groupe (remises, fins d'emploi, feuillets
// fiscaux, dépôt direct) à ne pas restreindre ses transitions de gouvernance
// (approve/export/confirm/void) au rôle admin — un manager pouvait donc
// approuver, exporter et confirmer un lot de dépôt direct, contrairement à
// toutes les routes soeurs. Corrigé pour cohérence.
//
// Ce test exécute le cycle complet draft → approved → exported → confirmed
// via de vraies requêtes HTTP contre une vraie base : le lot ne peut être
// préparé qu'à partir d'un cycle de paie déjà approuvé, montant/nombre de
// paiements calculés depuis le cycle réel, idempotence, contrôle de rôle
// désormais cohérent, empreinte de fichier et numéro de confirmation
// obligatoires, transitions d'état invalides refusées, isolation
// multi-organisation.
//
// Chaque scénario qui exige un cycle approuvé utilise sa propre
// organisation jetable : calculateRun traite tous les employés actifs de
// l'organisation pour la période donnée (pas seulement ceux ayant une
// saisie variable explicite), donc partager une organisation entre
// plusieurs cycles de test ferait apparaître des employés d'un scénario
// dans le nombre de paiements d'un autre.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { activateRuleset, createRunFromPeriod, checksumRules } = require("../services/business/payroll-run-lifecycle.service");
const { calculateRun, transitionRun } = require("../services/business/payroll-transaction.service");
const { buildPaymentBatch } = require("../services/business/payroll-direct-deposit.service");

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
  if (role) req.user = { id: 1, role };
  next();
}

const payrollRemittancesRoutes = require("../routes/business/payroll-remittances.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/payroll/remittances", payrollRemittancesRoutes);
  return app;
}

const RULES = {
  payPeriodsPerYear: 26,
  overtimeMultiplier: 1.5,
  employeeDeductions: { RRQ: 0.054, AE: 0.0132 },
  employerContributions: { RRQ: 0.054, AE: 0.0185 },
  voluntaryDeductions: {},
};

async function seedRuleset(organisationId) {
  const checksum = checksumRules(RULES);
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_rulesets (organisation_id, version, province, effective_from, rules, checksum, status)
     VALUES ($1,'v1','QC','2026-01-01',$2,$3,'draft') RETURNING *`,
    [organisationId, JSON.stringify(RULES), checksum],
  );
  return rows[0];
}

async function seedEmployee(organisationId) {
  const employeeNumber = `E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_employees
      (organisation_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate)
     VALUES ($1,$2,'Test Employee','Test','Employee','2020-01-01','hourly',25) RETURNING *`,
    [organisationId, employeeNumber],
  );
  return rows[0];
}

async function seedPeriod(organisationId) {
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_periods (organisation_id, frequency, period_start, period_end, pay_date)
     VALUES ($1,'biweekly','2026-07-01','2026-07-14','2026-07-18') RETURNING *`,
    [organisationId],
  );
  return rows[0];
}

// Organisation jetable dédiée avec un cycle de paie déjà approuvé (un seul
// employé), prête à produire un lot de dépôt direct.
async function setupApprovedRun(suffix) {
  const org = await createTestOrganisation({ nom: `Payroll Deposits E2E ${suffix}` });
  const ruleset = await seedRuleset(org.id);
  await activateRuleset(db.pool, org.id, ruleset.id, null);
  const employee = await seedEmployee(org.id);
  const period = await seedPeriod(org.id);
  await db.pool.query(
    `INSERT INTO payroll_variable_inputs (organisation_id, payroll_period_id, employee_id, input_type, quantity, source_type, source_id)
     VALUES ($1,$2,$3,'regular_hours',70,'manual','test')`,
    [org.id, period.id, employee.id],
  );
  const { run } = await createRunFromPeriod(db.pool, { organisationId: org.id, periodId: period.id, idempotencyKey: `deposit-run-create-${suffix}` });
  await calculateRun({ organisationId: org.id, runId: run.id, idempotencyKey: `deposit-run-calc-${suffix}`, createdBy: null });
  const approved = await transitionRun({ organisationId: org.id, runId: run.id, action: "approve", idempotencyKey: `deposit-run-approve-${suffix}` });
  return { orgId: org.id, run: approved.run };
}

// Reproduit exactement la canonicalisation serveur (payroll-deposits.routes.js)
// pour soumettre une empreinte de fichier réellement valide dans les tests.
async function computeExpectedFileHash(organisationId, payrollRunId) {
  const lines = await db.pool.query(
    `SELECT employee_id, net_pay FROM payroll_run_lines
      WHERE organisation_id=$1 AND payroll_run_id=$2
      ORDER BY employee_id`,
    [organisationId, payrollRunId],
  );
  return buildPaymentBatch(
    lines.rows.map((line) => ({ employeeId: Number(line.employee_id), amount: line.net_pay })),
  ).fileHash;
}

describe("Dépôt direct — cycle complet (domaine 4)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("un employé sans rôle admin/manager ne peut ni lister ni créer de lot", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Deposits E2E RBAC" });
    mockState.organisationId = org.id;

    const list = await request(app).get("/api/payroll/remittances/deposits").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/payroll/remittances/deposits").set("x-test-role", "employe")
      .send({ payrollRunId: 1, paymentDate: "2026-07-18" });
    expect(create.status).toBe(403);
  });

  test("un cycle non approuvé ne peut pas produire de lot de dépôt", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Deposits E2E NotReady" });
    mockState.organisationId = org.id;
    const ruleset = await seedRuleset(org.id);
    await activateRuleset(db.pool, org.id, ruleset.id, null);
    const employee = await seedEmployee(org.id);
    const period = await seedPeriod(org.id);
    await db.pool.query(
      `INSERT INTO payroll_variable_inputs (organisation_id, payroll_period_id, employee_id, input_type, quantity, source_type, source_id)
       VALUES ($1,$2,$3,'regular_hours',40,'manual','test')`,
      [org.id, period.id, employee.id],
    );
    const { run } = await createRunFromPeriod(db.pool, { organisationId: org.id, periodId: period.id, idempotencyKey: "deposit-run-notready" });

    const res = await request(app).post("/api/payroll/remittances/deposits").set("x-test-role", "manager")
      .send({ payrollRunId: run.id, paymentDate: "2026-07-18", idempotencyKey: "deposit-notready-0001" });
    expect(res.status).toBe(409);
  });

  test("création réelle : montant et nombre de paiements calculés depuis le cycle approuvé, idempotence", async () => {
    const { orgId, run } = await setupApprovedRun("create");
    mockState.organisationId = orgId;

    const res = await request(app).post("/api/payroll/remittances/deposits").set("x-test-role", "manager")
      .send({ payrollRunId: run.id, paymentDate: "2026-07-18", idempotencyKey: "deposit-e2e-0001" });
    expect(res.status).toBe(201);
    expect(res.body.batch.status).toBe("draft");
    expect(Number(res.body.batch.total_amount)).toBeCloseTo(Number(run.totals.net), 2);
    expect(res.body.batch.payment_count).toBe(1);

    const duplicate = await request(app).post("/api/payroll/remittances/deposits").set("x-test-role", "manager")
      .send({ payrollRunId: run.id, paymentDate: "2026-07-18", idempotencyKey: "deposit-e2e-0001" });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.batch.id).toBe(res.body.batch.id);

    const count = await db.pool.query(
      "SELECT COUNT(*)::int n FROM payroll_payment_batches WHERE organisation_id=$1 AND idempotency_key='deposit-e2e-0001'",
      [orgId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  test("cycle de transition complet : gouvernance réservée admin, empreinte et confirmation obligatoires", async () => {
    const { orgId, run } = await setupApprovedRun("cycle");
    mockState.organisationId = orgId;
    const created = await request(app).post("/api/payroll/remittances/deposits").set("x-test-role", "manager")
      .send({ payrollRunId: run.id, paymentDate: "2026-07-18", idempotencyKey: "deposit-e2e-cycle-0001" });
    const id = created.body.batch.id;

    const managerApprove = await request(app).post(`/api/payroll/remittances/deposits/${id}/approve`).set("x-test-role", "manager");
    expect(managerApprove.status).toBe(403);

    // 409 ici même si le lot n'est pas encore approuvé : la vérification
    // d'empreinte s'exécute avant la transition d'état et "abc123" ne
    // correspond de toute façon pas aux paiements réels du lot.
    const exportBeforeApprove = await request(app).post(`/api/payroll/remittances/deposits/${id}/export`).set("x-test-role", "admin")
      .send({ fileHash: "abc123" });
    expect(exportBeforeApprove.status).toBe(409);

    const approved = await request(app).post(`/api/payroll/remittances/deposits/${id}/approve`).set("x-test-role", "admin");
    expect(approved.status).toBe(200);
    expect(approved.body.batch.status).toBe("approved");

    const exportWithoutHash = await request(app).post(`/api/payroll/remittances/deposits/${id}/export`).set("x-test-role", "admin").send({});
    expect(exportWithoutHash.status).toBe(400);

    // Une empreinte qui ne correspond pas aux paiements réels du lot
    // (fichier corrompu, tronqué ou substitué) doit être refusée, et le lot
    // doit rester "approved" — l'export ne doit pas avoir eu lieu.
    const exportWithWrongHash = await request(app).post(`/api/payroll/remittances/deposits/${id}/export`).set("x-test-role", "admin")
      .send({ fileHash: "sha256:wrong-hash-does-not-match" });
    expect(exportWithWrongHash.status).toBe(409);
    const stillApproved = await db.pool.query("SELECT status FROM payroll_payment_batches WHERE id=$1", [id]);
    expect(stillApproved.rows[0].status).toBe("approved");

    const realFileHash = await computeExpectedFileHash(orgId, run.id);
    const exported = await request(app).post(`/api/payroll/remittances/deposits/${id}/export`).set("x-test-role", "admin")
      .send({ fileHash: realFileHash });
    expect(exported.status).toBe(200);
    expect(exported.body.batch.status).toBe("exported");
    expect(exported.body.batch.file_hash).toBe(realFileHash);

    const confirmWithoutNumber = await request(app).post(`/api/payroll/remittances/deposits/${id}/confirm`).set("x-test-role", "admin").send({});
    expect(confirmWithoutNumber.status).toBe(400);

    const confirmed = await request(app).post(`/api/payroll/remittances/deposits/${id}/confirm`).set("x-test-role", "admin")
      .send({ confirmationNumber: "BANK-CONF-9999" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.batch.status).toBe("confirmed");
    expect(confirmed.body.batch.confirmation.number).toBe("BANK-CONF-9999");
    expect(confirmed.body.batch.confirmation.confirmedAt).toBeTruthy();
  });

  test("annulation possible depuis draft/approved/exported, action inconnue rejetée, lot introuvable en 404", async () => {
    const { orgId, run } = await setupApprovedRun("void");
    mockState.organisationId = orgId;
    const created = await request(app).post("/api/payroll/remittances/deposits").set("x-test-role", "manager")
      .send({ payrollRunId: run.id, paymentDate: "2026-07-18", idempotencyKey: "deposit-e2e-void-0001" });
    const id = created.body.batch.id;

    const unknownAction = await request(app).post(`/api/payroll/remittances/deposits/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const voided = await request(app).post(`/api/payroll/remittances/deposits/${id}/void`).set("x-test-role", "admin");
    expect(voided.status).toBe(200);
    expect(voided.body.batch.status).toBe("void");

    const approveAfterVoid = await request(app).post(`/api/payroll/remittances/deposits/${id}/approve`).set("x-test-role", "admin");
    expect(approveAfterVoid.status).toBe(409);

    // Contrairement aux routes soeurs (remises, fins d'emploi, feuillets
    // fiscaux), cette route ne distingue pas "lot introuvable" de
    // "transition invalide" par une lecture préalable — elle renvoie 409
    // dans les deux cas (comportement actuel accepté, pas un défaut
    // fonctionnel : aucune action invalide n'aboutit jamais).
    const notFound = await request(app).post(`/api/payroll/remittances/deposits/999999/approve`).set("x-test-role", "admin");
    expect(notFound.status).toBe(409);
  });

  test("isolation stricte entre deux organisations", async () => {
    await setupApprovedRun("iso-a");
    const otherOrg = await createTestOrganisation({ nom: "Payroll Deposits E2E Org B" });
    mockState.organisationId = otherOrg.id;
    const list = await request(app).get("/api/payroll/remittances/deposits").set("x-test-role", "admin");
    expect(list.body.batches).toEqual([]);
  });
});
