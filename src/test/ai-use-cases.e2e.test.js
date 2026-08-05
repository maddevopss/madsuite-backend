// Étage 9 PR A — Registre des cas d'usage assistés (issue #195).
// Ce test exécute par de vraies requêtes HTTP contre une vraie base :
// déclaration au catalogue réservée à un super-admin plateforme (jamais
// un admin d'organisation), activation par organisation refusée pour un
// cas 'experimental'/'forbidden' (garde-fou contre l'activation
// implicite), activation réelle d'un cas 'approved', désactivation,
// RBAC et isolation multi-organisation.
const express = require("express");
const request = require("supertest");
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

const aiUseCasesRoutes = require("../routes/business/ai-use-cases.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/ai/use-cases", aiUseCasesRoutes);
  return app;
}

describe("Registre des cas d'usage assistés — catalogue et activation (Étage 9 PR A)", () => {
  let app;
  let orgId;
  let superAdminId;
  let orgAdminId;
  const originalMasterAdminIds = process.env.MASTER_ADMIN_USER_IDS;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "AI Use Cases E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const superAdmin = await createTestUser({ organisation_id: orgId, role: "admin" });
    const orgAdmin = await createTestUser({ organisation_id: orgId, role: "admin" });
    superAdminId = superAdmin.id;
    orgAdminId = orgAdmin.id;
    process.env.MASTER_ADMIN_USER_IDS = String(superAdminId);
    app = buildApp();
  });

  afterAll(() => {
    if (originalMasterAdminIds === undefined) delete process.env.MASTER_ADMIN_USER_IDS;
    else process.env.MASTER_ADMIN_USER_IDS = originalMasterAdminIds;
  });

  test("un admin d'organisation (non super-admin) ne peut pas déclarer de cas d'usage au catalogue", async () => {
    const res = await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId))
      .send({
        id: "incident-known-error-suggestion", version: "1.0", owner: "operations-lead", status: "approved",
        autonomy: "advisory", riskLevel: "low", dataClasses: ["operational_incidents", "operational_problems"],
        description: "Suggestion de correctif basée sur les erreurs connues",
      });
    expect(res.status).toBe(403);
  });

  test("un employé ne peut pas lister le catalogue", async () => {
    const res = await request(app).get("/api/ai/use-cases").set("x-test-role", "employe");
    expect(res.status).toBe(403);
  });

  test("validations : identité, statut, autonomie et classes de données invalides rejetées (super-admin)", async () => {
    const missingIdentity = await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(superAdminId))
      .send({ status: "approved", autonomy: "advisory", riskLevel: "low", dataClasses: ["x"], description: "Test" });
    expect(missingIdentity.status).toBe(400);

    const badStatus = await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(superAdminId))
      .send({ id: "test-case", version: "1.0", owner: "x", status: "BOGUS", autonomy: "advisory", riskLevel: "low", dataClasses: ["x"], description: "Test" });
    expect(badStatus.status).toBe(400);

    const emptyDataClasses = await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(superAdminId))
      .send({ id: "test-case", version: "1.0", owner: "x", status: "approved", autonomy: "advisory", riskLevel: "low", dataClasses: [], description: "Test" });
    expect(emptyDataClasses.status).toBe(400);
  });

  test("déclaration réelle au catalogue par le super-admin, doublon (id, version) refusé", async () => {
    const created = await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(superAdminId))
      .send({
        id: "incident-known-error-suggestion", version: "1.0", owner: "operations-lead", status: "approved",
        autonomy: "advisory", riskLevel: "low", dataClasses: ["operational_incidents", "operational_problems"],
        description: "Suggestion de correctif basée sur les erreurs connues du même service",
      });
    expect(created.status).toBe(201);
    expect(created.body.useCase.status).toBe("approved");

    const duplicate = await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(superAdminId))
      .send({
        id: "incident-known-error-suggestion", version: "1.0", owner: "operations-lead", status: "approved",
        autonomy: "advisory", riskLevel: "low", dataClasses: ["operational_incidents"],
        description: "Retentative",
      });
    expect(duplicate.status).toBe(409);
  });

  test("un cas d'usage 'experimental' ne peut pas être activé — garde-fou contre l'activation implicite", async () => {
    await request(app).post("/api/ai/use-cases").set("x-test-role", "admin").set("x-test-user-id", String(superAdminId))
      .send({
        id: "experimental-case", version: "1.0", owner: "x", status: "experimental",
        autonomy: "advisory", riskLevel: "medium", dataClasses: ["x"], description: "Test",
      });

    const activate = await request(app).post("/api/ai/use-cases/experimental-case/activate").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(activate.status).toBe(409);
  });

  test("un manager ne peut pas activer de cas d'usage (réservé admin d'organisation)", async () => {
    const managerAttempt = await request(app).post("/api/ai/use-cases/incident-known-error-suggestion/activate").set("x-test-role", "manager");
    expect(managerAttempt.status).toBe(403);
  });

  test("activation réelle d'un cas 'approved' par l'admin d'organisation, puis désactivation", async () => {
    const activated = await request(app).post("/api/ai/use-cases/incident-known-error-suggestion/activate").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(activated.status).toBe(201);
    expect(activated.body.activation.status).toBe("active");
    expect(activated.body.activation.use_case_version).toBe("1.0");

    const list = await request(app).get("/api/ai/use-cases/activations").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(list.body.activations.some((a) => a.use_case_id === "incident-known-error-suggestion" && a.status === "active")).toBe(true);

    const deactivated = await request(app).post("/api/ai/use-cases/incident-known-error-suggestion/deactivate").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.activation.status).toBe("disabled");

    const deactivateAgain = await request(app).post("/api/ai/use-cases/incident-known-error-suggestion/deactivate").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(deactivateAgain.status).toBe(200);
    expect(deactivateAgain.body.alreadyDisabled).toBe(true);
  });

  test("activer/désactiver un cas d'usage introuvable renvoie 404", async () => {
    const activateMissing = await request(app).post("/api/ai/use-cases/does-not-exist/activate").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(activateMissing.status).toBe(404);

    const deactivateNeverActivated = await request(app).post("/api/ai/use-cases/experimental-case/deactivate").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
    expect(deactivateNeverActivated.status).toBe(404);
  });

  test("isolation stricte : les activations d'une organisation sont invisibles depuis une autre", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AI Use Cases E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/ai/use-cases/activations").set("x-test-role", "admin").set("x-test-user-id", String(orgAdminId));
      expect(list.body.activations).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
