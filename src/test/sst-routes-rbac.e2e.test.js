// sst.routes.js n'appliquait jusqu'ici aucun requireRole, contrairement à
// hr.routes.js (admin partout) et payroll.routes.js (préparateur/
// approbateur) : n'importe quel utilisateur authentifié avec une
// organisation pouvait écrire des données SST. Ce test exécute par de
// vraies requêtes HTTP contre une vraie base la séparation ajoutée :
// déclaration (hasard/incident/inspection/EPI) ouverte à admin/manager,
// gouvernance d'une action corrective réservée à admin, lecture ouverte à
// tout utilisateur authentifié, non-authentifié toujours refusé (401).
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

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

describe("RBAC de sst.routes.js", () => {
  let app;
  let org;

  beforeAll(async () => {
    org = await createTestOrganisation({ nom: "SST RBAC E2E" });
    mockState.organisationId = org.id;
    app = buildApp();
  });

  test("la lecture reste ouverte à tout utilisateur authentifié (employe inclus)", async () => {
    const hazards = await request(app).get("/api/sst/hazards").set("x-test-role", "employe").set("x-test-user-id", "1");
    expect(hazards.status).toBe(200);
    const incidents = await request(app).get("/api/sst/incidents").set("x-test-role", "employe").set("x-test-user-id", "1");
    expect(incidents.status).toBe(200);
  });

  test("un employe ne peut pas déclarer un hasard, un incident, une inspection ou de l'EPI", async () => {
    const hazard = await request(app)
      .post("/api/sst/hazards")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "1")
      .send({ description: "Fil électrique dénudé", location: "Atelier" });
    expect(hazard.status).toBe(403);

    const incident = await request(app)
      .post("/api/sst/incidents")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "1")
      .send({ incidentType: "near_miss", occurredAt: new Date().toISOString(), location: "Atelier", description: "Test", severity: 2 });
    expect(incident.status).toBe(403);

    const inspection = await request(app)
      .post("/api/sst/inspections")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "1")
      .send({ inspectionType: "monthly", location: "Atelier" });
    expect(inspection.status).toBe(403);

    const ppe = await request(app)
      .post("/api/sst/ppe")
      .set("x-test-role", "employe")
      .set("x-test-user-id", "1")
      .send({ assetCode: "EPI-001", ppeType: "casque" });
    expect(ppe.status).toBe(403);
  });

  test("un utilisateur non authentifié est refusé (401), pas seulement 403", async () => {
    const attempt = await request(app).post("/api/sst/hazards").send({ description: "Test", location: "Atelier" });
    expect(attempt.status).toBe(401);
  });

  test("un manager peut déclarer un incident et une action corrective, mais pas gouverner (transitionner) l'action corrective", async () => {
    const incident = await request(app)
      .post("/api/sst/incidents")
      .set("x-test-role", "manager")
      .set("x-test-user-id", "2")
      .send({ incidentType: "near_miss", occurredAt: new Date().toISOString(), location: "Atelier", description: "Test manager", severity: 2, idempotencyKey: "rbac-incident-0001" });
    expect(incident.status).toBe(201);

    const action = await request(app)
      .post("/api/sst/corrective-actions")
      .set("x-test-role", "manager")
      .set("x-test-user-id", "2")
      .send({ sourceType: "incident", sourceId: incident.body.incident.id, title: "Corriger", description: "Corriger le problème", priority: "medium", dueAt: "2026-12-31" });
    expect(action.status).toBe(201);

    const transition = await request(app)
      .post(`/api/sst/corrective-actions/${action.body.id}/close`)
      .set("x-test-role", "manager")
      .set("x-test-user-id", "2")
      .send({ reason: "Test", idempotencyKey: "rbac-action-close-0001" });
    expect(transition.status).toBe(403);

    const transitionByAdmin = await request(app)
      .post(`/api/sst/corrective-actions/${action.body.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "3")
      .send({ reason: "Test", idempotencyKey: "rbac-action-close-0002" });
    expect(transitionByAdmin.status).toBe(200);
  });
});
