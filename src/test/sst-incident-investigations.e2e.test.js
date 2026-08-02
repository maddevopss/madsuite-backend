// Suite du même audit que hr-performance-reviews.e2e.test.js (2026-08-02) :
// sst-complete-block.service.js (transitionInvestigation, canCloseInvestigation)
// et la table sst_incident_investigations existaient (migration du 27/07)
// sans jamais être montés sur aucune route (grep exhaustif avant d'écrire ce
// fichier : aucun appelant hors du service lui-même et de son test de
// contrat, qui ne vérifie que la présence de fichiers/migrations). Ce test
// exécute le cycle de vie complet d'une enquête d'incident par de vraies
// requêtes HTTP contre une vraie base : ouverture, transitions
// (open -> collecting -> analysis -> review -> closed), garde-fou de
// fermeture (causes racines + preuves + actions correctives toutes
// fermées/annulées), une seule enquête par incident, idempotence et
// isolation multi-organisation.
//
// sst.routes.js interroge le pool via l'import `pool` (require("../../../db"))
// et non `req.db` : l'aide orgId(req) lit req.user?.organisation_id puis, à
// défaut, req.organisation_id (snake_case) — pas req.organisationId comme les
// autres modules. Le mock ci-dessous renseigne les deux pour rester robuste.
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

async function seedIncident(organisationId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO sst_incidents (organisation_id, incident_number, incident_type, occurred_at, location, description, severity)
     VALUES ($1,$2,'near_miss',NOW(),'Entrepôt','Chute de matériel',3) RETURNING *`,
    [organisationId, `INC-INV-${suffix}-${Date.now()}`],
  );
  return rows[0];
}

describe("Enquêtes d'incident SST (suite du 2026-08-02)", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test("cycle de vie complet : open -> collecting -> analysis -> review -> closed", async () => {
    const org = await createTestOrganisation({ nom: "SST Investigation E2E Lifecycle" });
    mockState.organisationId = org.id;
    const incident = await seedIncident(org.id, "lifecycle");

    const opened = await request(app)
      .post(`/api/sst/incidents/${incident.id}/investigation`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-open-0001" });
    expect(opened.status).toBe(201);
    expect(opened.body.investigation.status).toBe("open");
    const investigationId = opened.body.investigation.id;

    // Une seule enquête par incident.
    const duplicateOpen = await request(app)
      .post(`/api/sst/incidents/${incident.id}/investigation`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-open-0002" });
    expect(duplicateOpen.status).toBe(409);

    // Sauter directement à "closed" depuis "open" est refusé.
    const invalidJump = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-invalid-jump-0001" });
    expect(invalidJump.status).toBe(409);

    const toCollecting = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/collecting`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ witnessStatements: [{ name: "J. Tremblay", statement: "J’ai vu la palette tomber." }], idempotencyKey: "inv-transition-0001" });
    expect(toCollecting.status).toBe(201);
    expect(toCollecting.body.investigation.status).toBe("collecting");

    const toAnalysis = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/analysis`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ immediateCauses: [{ cause: "Arrimage insuffisant" }], idempotencyKey: "inv-transition-0002" });
    expect(toAnalysis.status).toBe(201);

    // La fermeture exige causes racines + preuves + actions correctives fermées : refusée tant qu'absentes.
    const toReview = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/review`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-transition-0003" });
    expect(toReview.status).toBe(201);
    expect(toReview.body.investigation.reviewed_at).toBeTruthy();

    const closeIncomplete = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-transition-0004" });
    expect(closeIncomplete.status).toBe(409);

    // Créer une action corrective liée à l'incident, encore ouverte : bloque toujours la fermeture.
    const action = await request(app)
      .post("/api/sst/corrective-actions")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ sourceType: "incident", sourceId: incident.id, title: "Réarrimer les palettes", description: "Revoir la procédure d’arrimage.", priority: "high", dueAt: "2026-12-31" });
    expect(action.status).toBe(201);

    const closeStillBlocked = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ rootCauses: [{ cause: "Absence de procédure d’arrimage" }], evidence: [{ type: "photo", url: "https://example.test/photo.jpg" }], idempotencyKey: "inv-transition-0005" });
    expect(closeStillBlocked.status).toBe(409);

    const closedAction = await request(app)
      .post(`/api/sst/corrective-actions/${action.body.id}/close`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ reason: "Arrimage corrigé", idempotencyKey: "action-close-0001" });
    expect(closedAction.status).toBe(200);

    // La tentative précédente (inv-transition-0005) a été refusée avant
    // écriture (transaction annulée) : rootCauses/evidence n'ont donc jamais
    // été persistés, il faut les fournir à nouveau pour cette fermeture.
    const closed = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/closed`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ rootCauses: [{ cause: "Absence de procédure d’arrimage" }], evidence: [{ type: "photo", url: "https://example.test/photo.jpg" }], idempotencyKey: "inv-transition-0006" });
    expect(closed.status).toBe(201);
    expect(closed.body.investigation.status).toBe("closed");
    expect(closed.body.investigation.closed_at).toBeTruthy();
  });

  test("idempotence : rejouer la même clé de transition ne modifie rien de plus", async () => {
    const org = await createTestOrganisation({ nom: "SST Investigation E2E Idempotency" });
    mockState.organisationId = org.id;
    const incident = await seedIncident(org.id, "idempotency");

    const opened = await request(app)
      .post(`/api/sst/incidents/${incident.id}/investigation`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-idem-open-0001" });
    const investigationId = opened.body.investigation.id;

    const first = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/collecting`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-idem-transition-0001" });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/collecting`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-idem-transition-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    const history = await db.pool.query("SELECT * FROM sst_incident_investigation_transitions WHERE organisation_id=$1 AND investigation_id=$2", [org.id, investigationId]);
    expect(history.rows).toHaveLength(1);
  });

  test("ouverture refusée pour un incident introuvable", async () => {
    const org = await createTestOrganisation({ nom: "SST Investigation E2E Missing Incident" });
    mockState.organisationId = org.id;

    const attempt = await request(app)
      .post("/api/sst/incidents/999999999/investigation")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-missing-incident-0001" });
    expect(attempt.status).toBe(404);
  });

  test("isolation stricte : une enquête d'une organisation est introuvable depuis une autre", async () => {
    const orgA = await createTestOrganisation({ nom: "SST Investigation E2E Org A" });
    const orgB = await createTestOrganisation({ nom: "SST Investigation E2E Org B" });

    mockState.organisationId = orgA.id;
    const incidentA = await seedIncident(orgA.id, "iso-a");
    const opened = await request(app)
      .post(`/api/sst/incidents/${incidentA.id}/investigation`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-iso-open-0001" });
    const investigationId = opened.body.investigation.id;

    mockState.organisationId = orgB.id;
    const crossOrgGet = await request(app)
      .get(`/api/sst/incidents/${incidentA.id}/investigation`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1");
    expect(crossOrgGet.status).toBe(404);

    const crossOrgTransition = await request(app)
      .post(`/api/sst/investigations/${investigationId}/transitions/collecting`)
      .set("x-test-role", "admin")
      .set("x-test-user-id", "1")
      .send({ idempotencyKey: "inv-iso-transition-0001" });
    expect(crossOrgTransition.status).toBe(404);
  });
});
