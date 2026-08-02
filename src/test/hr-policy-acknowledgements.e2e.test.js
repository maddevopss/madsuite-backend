// Suite du chantier RH/SST (2026-08-02) : hr-complete-block.service.js
// (buildPolicyAcknowledgement) et la table hr_policy_acknowledgements
// existaient (migration du 27/07) sans jamais être montés sur aucune
// route (grep exhaustif avant d'écrire ce fichier). Correspond à la
// section 1.C du mandat RH : accusé de réception / signature numérique
// avec traçabilité, invalidation et re-signature automatique lors des
// mises à jour de politiques. Ce test exécute par de vraies requêtes HTTP
// contre une vraie base : assignation, invalidation automatique d'une
// version antérieure, acquittement avec IP/horodatage capturés
// serveur-side, refus avec raison obligatoire, garde-fou (une seule
// décision), RBAC et isolation multi-organisation.
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
    [organisationId, `E-POLICY-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Accusés de réception de politiques RH (suite du 2026-08-02)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("assignation, acquittement avec traçabilité serveur, refus d'une seconde décision", async () => {
    const org = await createTestOrganisation({ nom: "HR Policy Ack E2E Lifecycle" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "lifecycle");

    const assigned = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, policyCode: "CODE-CONDUITE", policyVersion: "1.0", idempotencyKey: "policy-assign-0001" });
    expect(assigned.status).toBe(201);
    expect(assigned.body.acknowledgement.status).toBe("pending");
    const ackId = assigned.body.acknowledgement.id;

    const acknowledged = await request(app)
      .post(`/api/hr/policy-acknowledgements/${ackId}/acknowledge`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ evidence: { checkbox: true }, idempotencyKey: "policy-decide-0001" });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.acknowledgement.status).toBe("acknowledged");
    expect(acknowledged.body.acknowledgement.acknowledged_at).toBeTruthy();
    const lastEvidence = acknowledged.body.acknowledgement.evidence.at(-1);
    expect(lastEvidence.ip).toBeTruthy();
    expect(lastEvidence.decidedAt).toBeTruthy();
    expect(lastEvidence.method).toBe("acknowledge");

    // Une décision déjà prise ne peut pas être reprise.
    const again = await request(app)
      .post(`/api/hr/policy-acknowledgements/${ackId}/decline`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ reason: "Test", idempotencyKey: "policy-decide-0002" });
    expect(again.status).toBe(409);
  });

  test("assigner une nouvelle version invalide automatiquement l'ancienne demande en attente", async () => {
    const org = await createTestOrganisation({ nom: "HR Policy Ack E2E Versioning" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "versioning");

    const v1 = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, policyCode: "SST-GENERALE", policyVersion: "1.0", idempotencyKey: "policy-version-0001" });
    expect(v1.status).toBe(201);

    const v2 = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, policyCode: "SST-GENERALE", policyVersion: "2.0", idempotencyKey: "policy-version-0002" });
    expect(v2.status).toBe(201);
    expect(v2.body.invalidatedCount).toBe(1);

    const list = await request(app)
      .get(`/api/hr/policy-acknowledgements?employeeId=${employee.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    const v1Row = list.body.acknowledgements.find((row) => row.policy_version === "1.0");
    const v2Row = list.body.acknowledgements.find((row) => row.policy_version === "2.0");
    expect(v1Row.status).toBe("expired");
    expect(v2Row.status).toBe("pending");

    // L'ancienne demande, désormais expirée, ne peut plus être décidée.
    const decideExpired = await request(app)
      .post(`/api/hr/policy-acknowledgements/${v1Row.id}/acknowledge`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "policy-version-0003" });
    expect(decideExpired.status).toBe(409);
  });

  test("refuser exige une raison", async () => {
    const org = await createTestOrganisation({ nom: "HR Policy Ack E2E Decline" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "decline");

    const assigned = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, policyCode: "TELETRAVAIL", policyVersion: "1.0", idempotencyKey: "policy-decline-0001" });

    const missingReason = await request(app)
      .post(`/api/hr/policy-acknowledgements/${assigned.body.acknowledgement.id}/decline`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "policy-decline-0002" });
    expect(missingReason.status).toBe(400);

    const declined = await request(app)
      .post(`/api/hr/policy-acknowledgements/${assigned.body.acknowledgement.id}/decline`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ reason: "Désaccord avec la politique", idempotencyKey: "policy-decline-0003" });
    expect(declined.status).toBe(200);
    expect(declined.body.acknowledgement.status).toBe("declined");
  });

  test("assignation refusée pour un employé introuvable, RBAC hérité du routeur RH", async () => {
    const org = await createTestOrganisation({ nom: "HR Policy Ack E2E Missing/RBAC" });
    mockState.organisationId = org.id;

    const missingEmployee = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: 999999999, policyCode: "X", policyVersion: "1.0", idempotencyKey: "policy-missing-0001" });
    expect(missingEmployee.status).toBe(404);

    const employee = await seedEmployee(org.id, "rbac");
    const asEmploye = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "3")
      .send({ employeeId: employee.id, policyCode: "X", policyVersion: "1.0", idempotencyKey: "policy-rbac-0001" });
    expect(asEmploye.status).toBe(403);
  });

  test("isolation stricte : un accusé de réception d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "HR Policy Ack E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "HR Policy Ack E2E Org B" });

    mockState.organisationId = orgA.id;
    const employeeA = await seedEmployee(orgA.id, "iso-a");
    const assigned = await request(app)
      .post("/api/hr/policy-acknowledgements")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employeeA.id, policyCode: "X", policyVersion: "1.0", idempotencyKey: "policy-iso-0001" });

    mockState.organisationId = orgB.id;
    const crossOrgDecide = await request(app)
      .post(`/api/hr/policy-acknowledgements/${assigned.body.acknowledgement.id}/acknowledge`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "policy-iso-0002" });
    expect(crossOrgDecide.status).toBe(404);
  });
});
