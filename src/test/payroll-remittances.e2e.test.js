// Preuve d'exécution réelle du domaine 4 (paie), remises gouvernementales.
// Cartographie préalable : payroll-remittances.routes.js est réellement
// monté (/api/payroll/remittances) et sa logique (buildRemittance) a un test
// unitaire, mais aucun test n'exécute jamais une vraie requête SQL contre ce
// routeur — le seul test de route existant
// (payroll-remittances.route.contract.test.js) mocke intégralement req.db,
// donc ne peut détecter aucun bug SQL réel (même piège déjà rencontré dans
// les domaines précédents : POST / insère `evidence` — colonne jsonb — sans
// JSON.stringify()). Ce test exécute le cycle complet
// draft → approved → submitted → paid via de vraies requêtes HTTP contre une
// vraie base : contrôle de rôle à deux niveaux (préparation admin/manager,
// approbation admin seul), idempotence, transitions d'état valides/invalides,
// et isolation multi-organisation.
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

describe("Remises gouvernementales de paie — cycle complet (domaine 4)", () => {
  let app;
  let orgId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Remittances Paie E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();
  });

  test("un employé sans rôle admin/manager ne peut ni lister ni créer de remise", async () => {
    const list = await request(app).get("/api/payroll/remittances").set("x-test-role", "employe");
    expect(list.status).toBe(403);

    const create = await request(app).post("/api/payroll/remittances").set("x-test-role", "employe")
      .send({ authority: "RQ", remittanceType: "source_deductions", periodStart: "2026-07-01", periodEnd: "2026-07-14", dueDate: "2026-07-20", employeeAmount: 100, employerAmount: 50 });
    expect(create.status).toBe(403);
  });

  test("validations : autorité, type et période obligatoires", async () => {
    const badAuthority = await request(app).post("/api/payroll/remittances").set("x-test-role", "manager")
      .send({ authority: "BOGUS", remittanceType: "source_deductions", periodStart: "2026-07-01", periodEnd: "2026-07-14", dueDate: "2026-07-20" });
    expect(badAuthority.status).toBe(400);

    const missingPeriod = await request(app).post("/api/payroll/remittances").set("x-test-role", "manager")
      .send({ authority: "RQ", remittanceType: "source_deductions", dueDate: "2026-07-20" });
    expect(missingPeriod.status).toBe(400);
  });

  test("création réelle par un manager (préparation), montants et évidence jsonb persistés correctement", async () => {
    const res = await request(app).post("/api/payroll/remittances").set("x-test-role", "manager")
      .send({
        authority: "RQ",
        remittanceType: "source_deductions",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-14",
        dueDate: "2026-07-20",
        employeeAmount: 100.5,
        employerAmount: 50.25,
        evidence: [{ note: "Calcul basé sur le registre de paie #42" }],
        idempotencyKey: "remit-e2e-0001",
      });
    expect(res.status).toBe(201);
    expect(res.body.remittance.status).toBe("draft");
    expect(Number(res.body.remittance.employee_amount)).toBe(100.5);
    expect(Number(res.body.remittance.employer_amount)).toBe(50.25);
    expect(Number(res.body.remittance.total_amount)).toBe(150.75);
    expect(res.body.remittance.evidence).toEqual([{ note: "Calcul basé sur le registre de paie #42" }]);
  });

  test("idempotence : la même clé renvoie la remise existante, pas de doublon", async () => {
    const res = await request(app).post("/api/payroll/remittances").set("x-test-role", "manager")
      .send({
        authority: "RQ",
        remittanceType: "source_deductions",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-14",
        dueDate: "2026-07-20",
        employeeAmount: 999,
        employerAmount: 999,
        idempotencyKey: "remit-e2e-0001",
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.remittance.employee_amount)).toBe(100.5); // valeurs d'origine, pas 999

    const count = await db.pool.query(
      "SELECT COUNT(*)::int n FROM payroll_remittances WHERE organisation_id=$1 AND idempotency_key='remit-e2e-0001'",
      [orgId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  test("cycle de transition complet : approbation réservée admin, soumission, paiement avec confirmation obligatoire", async () => {
    const created = await request(app).post("/api/payroll/remittances").set("x-test-role", "manager")
      .send({
        authority: "CRA",
        remittanceType: "source_deductions",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-14",
        dueDate: "2026-08-20",
        employeeAmount: 200,
        employerAmount: 100,
        idempotencyKey: "remit-e2e-cycle-0001",
      });
    const id = created.body.remittance.id;

    const managerApprove = await request(app).post(`/api/payroll/remittances/${id}/approve`).set("x-test-role", "manager");
    expect(managerApprove.status).toBe(403);

    const submitBeforeApprove = await request(app).post(`/api/payroll/remittances/${id}/submit`).set("x-test-role", "admin");
    expect(submitBeforeApprove.status).toBe(409);

    const approved = await request(app).post(`/api/payroll/remittances/${id}/approve`).set("x-test-role", "admin");
    expect(approved.status).toBe(200);
    expect(approved.body.remittance.status).toBe("approved");

    const submitted = await request(app).post(`/api/payroll/remittances/${id}/submit`).set("x-test-role", "admin");
    expect(submitted.status).toBe(200);
    expect(submitted.body.remittance.status).toBe("submitted");
    expect(submitted.body.remittance.submitted_at).toBeTruthy();

    const payWithoutConfirmation = await request(app).post(`/api/payroll/remittances/${id}/pay`).set("x-test-role", "admin").send({});
    expect(payWithoutConfirmation.status).toBe(400);

    const paid = await request(app).post(`/api/payroll/remittances/${id}/pay`).set("x-test-role", "admin").send({ confirmationNumber: "CONF-12345" });
    expect(paid.status).toBe(200);
    expect(paid.body.remittance.status).toBe("paid");
    expect(paid.body.remittance.confirmation_number).toBe("CONF-12345");
    expect(paid.body.remittance.paid_at).toBeTruthy();
  });

  test("annulation possible depuis draft/approved/submitted, action inconnue rejetée", async () => {
    const created = await request(app).post("/api/payroll/remittances").set("x-test-role", "manager")
      .send({
        authority: "CNESST",
        remittanceType: "source_deductions",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-14",
        dueDate: "2026-09-20",
        employeeAmount: 10,
        employerAmount: 20,
        idempotencyKey: "remit-e2e-void-0001",
      });
    const id = created.body.remittance.id;

    const unknownAction = await request(app).post(`/api/payroll/remittances/${id}/frobnicate`).set("x-test-role", "admin");
    expect(unknownAction.status).toBe(404);

    const voided = await request(app).post(`/api/payroll/remittances/${id}/void`).set("x-test-role", "admin");
    expect(voided.status).toBe(200);
    expect(voided.body.remittance.status).toBe("void");

    const approveAfterVoid = await request(app).post(`/api/payroll/remittances/${id}/approve`).set("x-test-role", "admin");
    expect(approveAfterVoid.status).toBe(409);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Remittances Paie E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/payroll/remittances").set("x-test-role", "admin");
      expect(list.body.remittances).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
