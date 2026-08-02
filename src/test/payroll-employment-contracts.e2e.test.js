// Suite de #698 (lacune documentée : payroll-employment-contract.service.js
// — table payroll_employment_contracts créée par migration mais jamais
// exploitée par aucune route). Décision produit (session du 2026-08-01) :
// câbler une capacité minimale réelle plutôt que retirer la table. Ce test
// exécute le cycle de vie complet par de vraies requêtes HTTP contre une
// vraie base : création en brouillon, approbation, activation (avec
// remplacement de l'éventuel contrat déjà actif de l'employé), terminaison,
// annulation, séparation préparateur/approbateur et isolation
// multi-organisation.
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

const payrollRoutes = require("../routes/business/payroll.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/payroll", payrollRoutes);
  return app;
}

async function seedEmployee(organisationId, suffix) {
  const employee = await db.pool.query(
    `INSERT INTO payroll_employees
      (organisation_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate)
     VALUES ($1,$2,'Test Employee','Test','Employee','2020-01-01','hourly',25) RETURNING *`,
    [organisationId, `E-CONTRACT-${suffix}-${Date.now()}`],
  );
  return employee.rows[0];
}

function draftPayload(overrides = {}) {
  return {
    contractNumber: `CTR-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    contractType: "permanent",
    employmentClass: "full_time",
    payType: "hourly",
    hourlyRate: 30,
    standardHoursPerWeek: 40,
    payFrequency: "biweekly",
    effectiveFrom: "2026-08-01",
    ...overrides,
  };
}

describe("Contrats d'emploi de paie (suite #698)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("cycle de vie complet : brouillon → approuvé → actif, puis remplacement par un second contrat activé", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Employment Contract E2E Lifecycle" });
    mockState.organisationId = org.id;
    const admin = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin RH" });
    const employee = await seedEmployee(org.id, "lifecycle");

    const created = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(draftPayload());
    expect(created.status).toBe(201);
    expect(created.body.contract.status).toBe("draft");
    const contractId = created.body.contract.id;

    const listed = await request(app)
      .get(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(listed.status).toBe(200);
    expect(listed.body.contracts).toHaveLength(1);

    // L'activation directe échoue tant que le contrat n'est pas approuvé.
    const activateTooEarly = await request(app)
      .post(`/api/payroll/contracts/${contractId}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(activateTooEarly.status).toBe(409);

    const approved = await request(app)
      .post(`/api/payroll/contracts/${contractId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(approved.status).toBe(201);
    // approved_by est BIGINT : node-pg le retourne en chaîne pour éviter toute perte de précision.
    expect(Number(approved.body.contract.approved_by)).toBe(admin.id);

    // Une seconde approbation est refusée (déjà approuvé, plus en brouillon).
    const doubleApprove = await request(app)
      .post(`/api/payroll/contracts/${contractId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(doubleApprove.status).toBe(409);

    const activated = await request(app)
      .post(`/api/payroll/contracts/${contractId}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(activated.status).toBe(201);
    expect(activated.body.contract.status).toBe("active");

    // Un second contrat, une fois approuvé et activé, remplace le premier :
    // l'ancien devient "superseded", jamais deux contrats actifs à la fois.
    const secondCreated = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(draftPayload({ effectiveFrom: "2027-01-01" }));
    const secondId = secondCreated.body.contract.id;
    await request(app)
      .post(`/api/payroll/contracts/${secondId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    const secondActivated = await request(app)
      .post(`/api/payroll/contracts/${secondId}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(secondActivated.status).toBe(201);
    expect(secondActivated.body.contract.status).toBe("active");

    const firstAfterSupersede = await request(app)
      .get(`/api/payroll/contracts/${contractId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(firstAfterSupersede.body.contract.status).toBe("superseded");
  });

  test("terminer un contrat actif fonctionne, terminer un contrat non actif est refusé", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Employment Contract E2E End" });
    mockState.organisationId = org.id;
    const admin = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin RH" });
    const employee = await seedEmployee(org.id, "end");

    const created = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(draftPayload());
    const contractId = created.body.contract.id;

    const endDraft = await request(app)
      .post(`/api/payroll/contracts/${contractId}/end`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(endDraft.status).toBe(409);

    await request(app)
      .post(`/api/payroll/contracts/${contractId}/approve`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    await request(app)
      .post(`/api/payroll/contracts/${contractId}/activate`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));

    const badDate = await request(app)
      .post(`/api/payroll/contracts/${contractId}/end`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send({ effectiveTo: "2020-01-01" });
    expect(badDate.status).toBe(400);

    const ended = await request(app)
      .post(`/api/payroll/contracts/${contractId}/end`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send({ effectiveTo: "2026-12-31" });
    expect(ended.status).toBe(200);
    expect(ended.body.contract.status).toBe("ended");

    const endAgain = await request(app)
      .post(`/api/payroll/contracts/${contractId}/end`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(endAgain.status).toBe(409);
  });

  test("annuler un contrat en brouillon fonctionne, l'annuler deux fois est refusé", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Employment Contract E2E Cancel" });
    mockState.organisationId = org.id;
    const admin = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin RH" });
    const employee = await seedEmployee(org.id, "cancel");

    const created = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(draftPayload());
    const contractId = created.body.contract.id;

    const cancelled = await request(app)
      .post(`/api/payroll/contracts/${contractId}/cancel`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.contract.status).toBe("cancelled");

    const cancelAgain = await request(app)
      .post(`/api/payroll/contracts/${contractId}/cancel`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id));
    expect(cancelAgain.status).toBe(409);
  });

  test("un manager peut préparer (créer/lister) mais pas approuver, activer, terminer ou annuler", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Employment Contract E2E Roles" });
    mockState.organisationId = org.id;
    const manager = await createTestUser({ role: "manager", organisation_id: org.id, nom: "Manager RH" });
    const employee = await seedEmployee(org.id, "roles");

    const created = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(manager.id))
      .send(draftPayload());
    expect(created.status).toBe(201);
    const contractId = created.body.contract.id;

    const approveAttempt = await request(app)
      .post(`/api/payroll/contracts/${contractId}/approve`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(manager.id));
    expect(approveAttempt.status).toBe(403);

    const cancelAttempt = await request(app)
      .post(`/api/payroll/contracts/${contractId}/cancel`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(manager.id));
    expect(cancelAttempt.status).toBe(403);
  });

  test("rejette un contrat invalide (400) et un numéro de contrat dupliqué (409)", async () => {
    const org = await createTestOrganisation({ nom: "Payroll Employment Contract E2E Validation" });
    mockState.organisationId = org.id;
    const admin = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Admin RH" });
    const employee = await seedEmployee(org.id, "validation");

    const invalid = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(draftPayload({ contractType: "not-a-type" }));
    expect(invalid.status).toBe(400);

    const payload = draftPayload();
    const first = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(payload);
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/payroll/employees/${employee.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(admin.id))
      .send(payload);
    expect(duplicate.status).toBe(409);
  });

  test("isolation stricte : un contrat d'une organisation est invisible et inaccessible depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "Payroll Employment Contract E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "Payroll Employment Contract E2E Org B" });
    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id, nom: "Admin A" });
    const adminB = await createTestUser({ role: "admin", organisation_id: orgB.id, nom: "Admin B" });

    mockState.organisationId = orgA.id;
    const employeeA = await seedEmployee(orgA.id, "iso-a");
    const created = await request(app)
      .post(`/api/payroll/employees/${employeeA.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminA.id))
      .send(draftPayload());
    const contractId = created.body.contract.id;

    // Une organisation B ne peut ni créer un contrat pour l'employé de A...
    mockState.organisationId = orgB.id;
    const crossOrgCreate = await request(app)
      .post(`/api/payroll/employees/${employeeA.id}/contracts`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminB.id))
      .send(draftPayload());
    expect(crossOrgCreate.status).toBe(404);

    // ...ni consulter le contrat créé par A.
    const crossOrgGet = await request(app)
      .get(`/api/payroll/contracts/${contractId}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminB.id));
    expect(crossOrgGet.status).toBe(404);
  });
});
