// Suite du même audit RH/SST (2026-08-02) : sst-complete-block.service.js
// (assessInspectionClosure) et la table sst_inspection_closures existaient
// (migration du 27/07) sans jamais être montés sur aucune route (grep
// exhaustif avant d'écrire ce fichier). Ce test exécute la fermeture
// d'inspection par de vraies requêtes HTTP contre une vraie base : garde-fou
// (checklist complétée + aucun constat critique sans action corrective
// réelle et vérifiée en base), calcul automatique du résultat
// (pass/conditional/fail), contresignature distincte, idempotence, RBAC et
// isolation multi-organisation.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

const mockState = { organisationId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.organisation_id = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  const userId = req.header("x-test-user-id");
  if (role) req.user = { id: userId ? Number(userId) : null, role, organisation_id: mockState.organisationId };
  next();
}

const sstRoutes = require("../routes/business/sst.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/sst", sstRoutes);
  return app;
}

async function seedInspection(organisationId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO sst_inspections (organisation_id, inspection_number, inspection_type, location)
     VALUES ($1,$2,'monthly','Entrepôt') RETURNING *`,
    [organisationId, `INS-CLOSURE-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Fermeture d'inspection SST (suite du 2026-08-02)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("fermeture sans constat : résultat 'pass', inspection marquée fermée", async () => {
    const org = await createTestOrganisation({ nom: "SST Inspection Closure E2E Pass" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    const inspection = await seedInspection(org.id, "pass");

    const closed = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ completedChecklist: [{ item: "Sorties de secours dégagées", checked: true }], findings: [], idempotencyKey: "close-pass-0001" });
    expect(closed.status).toBe(201);
    expect(closed.body.closure.result).toBe("pass");

    const fetched = await request(app)
      .get(`/api/sst/inspections/${inspection.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id));
    expect(fetched.body.inspection.status).toBe("completed");
    expect(fetched.body.inspection.result).toBe("pass");
    expect(fetched.body.closure.result).toBe("pass");

    // Une inspection déjà fermée ne peut pas être refermée.
    const reclosed = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ completedChecklist: [{ item: "x", checked: true }], idempotencyKey: "close-pass-0002" });
    expect(reclosed.status).toBe(409);

    // Rejouer la même clé retourne la fermeture existante sans en créer une seconde.
    const replay = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ completedChecklist: [{ item: "Sorties de secours dégagées", checked: true }], findings: [], idempotencyKey: "close-pass-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  test("un constat critique sans action corrective valide bloque la fermeture, même avec un identifiant fourni mais inexistant", async () => {
    const org = await createTestOrganisation({ nom: "SST Inspection Closure E2E Critical" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    const inspection = await seedInspection(org.id, "critical");

    const blockedNoAction = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ completedChecklist: [{ item: "x", checked: true }], findings: [{ severity: "critical", description: "Extincteur périmé" }], idempotencyKey: "close-critical-0001" });
    expect(blockedNoAction.status).toBe(409);

    const blockedFakeAction = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ completedChecklist: [{ item: "x", checked: true }], findings: [{ severity: "critical", description: "Extincteur périmé", correctiveActionId: 999999999 }], idempotencyKey: "close-critical-0002" });
    expect(blockedFakeAction.status).toBe(409);

    // Créer une vraie action corrective liée à l'inspection.
    const action = await request(app)
      .post("/api/sst/corrective-actions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({ sourceType: "inspection", sourceId: inspection.id, title: "Remplacer l’extincteur", description: "Extincteur périmé à remplacer", priority: "critical", dueAt: "2026-12-31" });
    expect(action.status).toBe(201);

    const closedWithRealAction = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(user.id))
      .send({
        completedChecklist: [{ item: "x", checked: true }],
        findings: [{ severity: "critical", description: "Extincteur périmé", correctiveActionId: action.body.id }],
        idempotencyKey: "close-critical-0003",
      });
    expect(closedWithRealAction.status).toBe(201);
    expect(closedWithRealAction.body.closure.result).toBe("conditional");
  });

  test("la contresignature est un geste distinct, refusé aux non-admins, refusé deux fois", async () => {
    const org = await createTestOrganisation({ nom: "SST Inspection Closure E2E Sign-off" });
    mockState.organisationId = org.id;
    const managerUser = await createTestUser({ organisation_id: org.id, role: "manager" });
    const employeUser = await createTestUser({ organisation_id: org.id, role: "employe" });
    const adminUser = await createTestUser({ organisation_id: org.id, role: "admin" });
    const inspection = await seedInspection(org.id, "signoff");

    await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(managerUser.id))
      .send({ completedChecklist: [{ item: "x", checked: true }], findings: [], idempotencyKey: "close-signoff-0001" });

    const approveByEmploye = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/approve-closure`)
      .set("x-test-role", "employe")
      .set("x-test-user-id", String(employeUser.id))
      .send({ idempotencyKey: "approve-signoff-0001" });
    expect(approveByEmploye.status).toBe(403);

    const approveByManager = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/approve-closure`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", String(managerUser.id))
      .send({ idempotencyKey: "approve-signoff-0002" });
    expect(approveByManager.status).toBe(403);

    const approveByAdmin = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/approve-closure`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminUser.id))
      .send({ idempotencyKey: "approve-signoff-0003" });
    expect(approveByAdmin.status).toBe(200);
    expect(Number(approveByAdmin.body.closure.approved_by)).toBe(Number(adminUser.id));

    const approveAgain = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/approve-closure`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", String(adminUser.id))
      .send({ idempotencyKey: "approve-signoff-0004" });
    expect(approveAgain.status).toBe(409);
  });

  test("un employe ne peut pas fermer d'inspection", async () => {
    const org = await createTestOrganisation({ nom: "SST Inspection Closure E2E RBAC" });
    mockState.organisationId = org.id;
    const user = await createTestUser({ organisation_id: org.id, role: "admin" });
    const inspection = await seedInspection(org.id, "rbac");

    const attempt = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "employe")
      .set("x-test-user-id", "3")
      .send({ completedChecklist: [], idempotencyKey: "close-rbac-0001" });
    expect(attempt.status).toBe(403);
  });

  test("isolation stricte : une inspection d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "SST Inspection Closure E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "SST Inspection Closure E2E Org B" });

    mockState.organisationId = orgA.id;
    const inspection = await seedInspection(orgA.id, "iso-a");

    mockState.organisationId = orgB.id;
    const crossOrgGet = await request(app)
      .get(`/api/sst/inspections/${inspection.id}`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(crossOrgGet.status).toBe(404);

    const crossOrgClose = await request(app)
      .post(`/api/sst/inspections/${inspection.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ completedChecklist: [], idempotencyKey: "close-iso-0001" });
    expect(crossOrgClose.status).toBe(404);
  });
});
