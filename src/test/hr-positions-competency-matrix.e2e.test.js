// Postes et matrice de compétences requises RH (mandat 1.A/1.E) : nouvelle
// conception, comme hr_departments (#712) -- job_title est un champ texte
// libre sur hr_employees, sans entité "poste" réelle ni lien possible vers
// les compétences requises pour l'occuper. Ce test exécute par de vraies
// requêtes HTTP contre une vraie base : création de poste, définition de
// la matrice de compétences requises, rattachement d'un employé, calcul
// réel des écarts de qualification (compétences manquantes), doublon de
// code, RBAC hérité et isolation multi-organisation.
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
    [organisationId, `E-POS-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Postes et matrice de compétences RH (nouvelle conception)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("créer un poste, définir sa matrice de compétences requises, calculer les écarts réels d'un employé", async () => {
    const org = await createTestOrganisation({ nom: "HR Positions E2E Lifecycle" });
    mockState.organisationId = org.id;
    const employee = await seedEmployee(org.id, "lifecycle");

    const position = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "GRUTIER", title: "Grutier", idempotencyKey: "pos-lifecycle-0001" });
    expect(position.status).toBe(201);
    const positionId = position.body.position.id;

    const compA = await request(app)
      .post("/api/hr/competencies")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "GRUE-MOBILE", name: "Grue mobile" });
    const compB = await request(app)
      .post("/api/hr/competencies")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "ELINGAGE", name: "Élingage" });

    const matrix = await request(app)
      .put(`/api/hr/positions/${positionId}/required-competencies`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ competencyIds: [compA.body.competency.id, compB.body.competency.id] });
    expect(matrix.status).toBe(200);
    expect(matrix.body.requiredCompetencies).toHaveLength(2);

    const assigned = await request(app)
      .patch(`/api/hr/employees/${employee.id}/position`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ positionId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.employee.position_id).toBe(positionId);

    // Aucune compétence détenue : les 2 requises manquent.
    const gapsBefore = await request(app)
      .get(`/api/hr/employees/${employee.id}/qualification-gaps`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(gapsBefore.status).toBe(200);
    expect(gapsBefore.body.missing).toHaveLength(2);

    // L'employé obtient la compétence "Grue mobile" : il ne manque plus que "Élingage".
    await request(app)
      .post("/api/hr/employee-competencies")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ employeeId: employee.id, competencyId: compA.body.competency.id, issuedAt: "2026-01-01", idempotencyKey: "pos-lifecycle-comp-0001" });

    const gapsAfter = await request(app)
      .get(`/api/hr/employees/${employee.id}/qualification-gaps`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(gapsAfter.body.missing).toHaveLength(1);
    expect(gapsAfter.body.missing[0].code).toBe("ELINGAGE");
  });

  test("un code de poste dupliqué est refusé, idempotence sur la création", async () => {
    const org = await createTestOrganisation({ nom: "HR Positions E2E Duplicate" });
    mockState.organisationId = org.id;

    const first = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "ELECTRICIEN", title: "Électricien", idempotencyKey: "pos-dup-0001" });
    expect(first.status).toBe(201);

    const duplicateCode = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "ELECTRICIEN", title: "Électricien (bis)", idempotencyKey: "pos-dup-0002" });
    expect(duplicateCode.status).toBe(409);

    const replay = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "ELECTRICIEN", title: "Électricien", idempotencyKey: "pos-dup-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  test("une compétence inexistante dans la matrice requise est refusée, RBAC hérité", async () => {
    const org = await createTestOrganisation({ nom: "HR Positions E2E Missing/RBAC" });
    mockState.organisationId = org.id;

    const position = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "SOUDEUR", title: "Soudeur", idempotencyKey: "pos-missing-0001" });

    const invalidMatrix = await request(app)
      .put(`/api/hr/positions/${position.body.position.id}/required-competencies`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ competencyIds: [999999999] });
    expect(invalidMatrix.status).toBe(404);

    const asEmploye = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "3")
      .send({ code: "X", title: "X", idempotencyKey: "pos-rbac-0001" });
    expect(asEmploye.status).toBe(403);
  });

  test("isolation stricte : un poste d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "HR Positions E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "HR Positions E2E Org B" });

    mockState.organisationId = orgA.id;
    const position = await request(app)
      .post("/api/hr/positions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ code: "ISO", title: "Isolation", idempotencyKey: "pos-iso-0001" });

    mockState.organisationId = orgB.id;
    const crossOrgUpdate = await request(app)
      .patch(`/api/hr/positions/${position.body.position.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ title: "Renommé" });
    expect(crossOrgUpdate.status).toBe(404);
  });
});
