/**
 * Issue #175 (Étage 7) PR C — scénarios interorganisation.
 *
 * Comme pour la PR B (voir stage7PriorityJourneys.e2e.test.js), la branche
 * `test/stage7-cross-tenant-scenarios` déjà présente dans le repo est
 * inexploitable (lignée divergente sans base de fusion) et son seul contenu
 * réel (`stage7-cross-tenant-scenarios.contract.test.js`) est un test unitaire
 * sur une fonction factice locale, pas une preuve contre les routes réelles.
 * Ce fichier repart de zéro sur `main` actuel.
 *
 * Preuve réelle (requêtes HTTP + vraie base PostgreSQL) des exigences de
 * l'issue #175 PR C :
 *   1. accès refusés (lecture en liste, une organisation ne voit jamais les
 *      lignes d'une autre) ;
 *   2. accès refusés (écriture/transition sur une ressource d'une autre
 *      organisation) ;
 *   3. références croisées refusées (impossible de rattacher une ressource
 *      créée par l'organisation courante à un parent appartenant à une autre
 *      organisation) ;
 *   4. tâches et événements isolés (constats d'audit, événements de
 *      résilience) ;
 *   5. sessions conservant la bonne organisation (le contexte d'organisation
 *      vient toujours de la session/l'utilisateur authentifié, jamais d'une
 *      valeur fournie par le client).
 *
 * Constat fait en écrivant la preuve n°3 : les routes de création
 * enterprise-risk (assessments/controls/treatments/reviews/incidents),
 * institutional-resilience (crisis-cells/decisions/communications/timeline)
 * et advanced-document-governance (documents/versions/access-reviews)
 * inséraient un id référencé (risk_id, event_id, classification_id,
 * document_id) sans jamais vérifier qu'il appartenait à l'organisation de la
 * session — seule la contrainte FK (existence, pas organisation) protégeait
 * ces colonnes. Une organisation B pouvait donc rattacher une ligne à elle
 * (organisation_id = B) référençant une ressource appartenant à
 * l'organisation A. Corrigé dans ce commit (voir diff des fichiers de route)
 * avant d'écrire la preuve ci-dessous — sinon la preuve n°3 aurait échoué.
 */
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

// --- App n°1 : middleware d'organisation mocké, org sélectionnée par en-tête,
// pour driver des requêtes comme organisation A ou B dans le même test. ---
const mockState = { orgs: {} };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    const key = req.header("x-test-org");
    req.organisationId = mockState.orgs[key];
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  req.user = { id: 1, role: "admin" };
  next();
}

const enterpriseRiskRoutes = require("../routes/business/enterprise-risk.routes");
const institutionalResilienceRoutes = require("../routes/business/institutional-resilience.routes");
const internalAuditRoutes = require("../routes/business/internal-audit.routes");
const advancedDocumentGovernanceRoutes = require("../routes/business/advanced-document-governance.routes");
const errorHandler = require("../middleware/errorHandler");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/risks", enterpriseRiskRoutes);
  app.use("/api/resilience", institutionalResilienceRoutes);
  app.use("/api/internal-audit", internalAuditRoutes);
  app.use("/api/document-governance", advancedDocumentGovernanceRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function idem(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asOrg(reqBuilder, key) {
  return reqBuilder.set("x-test-org", key);
}

describe("Étage 7 PR C — scénarios interorganisation", () => {
  let orgA, orgB, userA, userB;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Stage7 PR C — Org A ${Date.now()}` });
    orgB = await createTestOrganisation({ nom: `Stage7 PR C — Org B ${Date.now()}` });
    userA = await createTestUser({ organisation_id: orgA.id, role: "admin" });
    userB = await createTestUser({ organisation_id: orgB.id, role: "admin" });
    mockState.orgs.A = orgA.id;
    mockState.orgs.B = orgB.id;
  });

  afterAll(async () => {
    await db.query("DELETE FROM utilisateurs WHERE id = ANY($1)", [[userA?.id, userB?.id].filter(Boolean)]);
    await db.query("DELETE FROM organisations WHERE id = ANY($1)", [[orgA?.id, orgB?.id].filter(Boolean)]);
  });

  test("1. accès refusés en lecture — une organisation ne voit jamais les listes d'une autre", async () => {
    const markerA = `RISK-CROSS-A-${Date.now()}`;
    const markerB = `RISK-CROSS-B-${Date.now()}`;

    const riskA = await asOrg(request(app).post("/api/risks"), "A")
      .set("Idempotency-Key", idem("cross-risk-a"))
      .send({ riskNumber: markerA, category: "operational", title: "Risque org A", description: "desc", ownerUserId: userA.id, likelihood: 2, impact: 2 });
    expect(riskA.status).toBe(201);

    const riskB = await asOrg(request(app).post("/api/risks"), "B")
      .set("Idempotency-Key", idem("cross-risk-b"))
      .send({ riskNumber: markerB, category: "operational", title: "Risque org B", description: "desc", ownerUserId: userB.id, likelihood: 2, impact: 2 });
    expect(riskB.status).toBe(201);

    const listAsA = await asOrg(request(app).get("/api/risks"), "A");
    const listAsB = await asOrg(request(app).get("/api/risks"), "B");

    expect(listAsA.body.some((r) => r.risk_number === markerA)).toBe(true);
    expect(listAsA.body.some((r) => r.risk_number === markerB)).toBe(false);
    expect(listAsB.body.some((r) => r.risk_number === markerB)).toBe(true);
    expect(listAsB.body.some((r) => r.risk_number === markerA)).toBe(false);
  });

  test("2. accès refusés en écriture — transition sur une ressource d'une autre organisation", async () => {
    const treatmentA = await asOrg(request(app).post("/api/risks"), "A")
      .set("Idempotency-Key", idem("cross-write-risk-a"))
      .send({ riskNumber: `RISK-WRITE-A-${Date.now()}`, category: "operational", title: "Risque org A", description: "desc", ownerUserId: userA.id, likelihood: 2, impact: 2 });
    const riskIdA = treatmentA.body.id;

    const treatment = await asOrg(request(app).post("/api/risks/treatments"), "A")
      .set("Idempotency-Key", idem("cross-write-treatment-a"))
      .send({ riskId: riskIdA, treatmentNumber: `TRT-WRITE-A-${Date.now()}`, strategy: "reduce", description: "desc", ownerUserId: userA.id });
    expect(treatment.status).toBe(201);
    const treatmentId = treatment.body.id;

    // Org B tente de transitionner un traitement appartenant à org A : la ligne
    // n'existe simplement pas dans son périmètre (organisation_id filtré).
    const crossTransition = await asOrg(request(app).post(`/api/risks/treatments/${treatmentId}/transition`), "B")
      .set("Idempotency-Key", idem("cross-write-transition-b"))
      .send({ action: "implemented", evidence: ["fixture://x"] });
    expect(crossTransition.status).toBe(404);

    // Org A, elle, peut transitionner sa propre ressource (sanity check).
    const ownTransition = await asOrg(request(app).post(`/api/risks/treatments/${treatmentId}/transition`), "A")
      .set("Idempotency-Key", idem("cross-write-transition-a"))
      .send({ action: "implemented", evidence: ["fixture://x"] });
    expect(ownTransition.status).toBe(200);
  });

  test("3. références croisées refusées — impossible de rattacher une ressource à un parent d'une autre organisation", async () => {
    // Risque d'org A, puis org B tente de créer une évaluation/un contrôle/un
    // traitement/une revue/un incident référençant ce risque.
    const riskA = await asOrg(request(app).post("/api/risks"), "A")
      .set("Idempotency-Key", idem("cross-ref-risk-a"))
      .send({ riskNumber: `RISK-REF-A-${Date.now()}`, category: "operational", title: "Risque org A", description: "desc", ownerUserId: userA.id, likelihood: 2, impact: 2 });
    const riskIdA = riskA.body.id;

    const assessment = await asOrg(request(app).post("/api/risks/assessments"), "B")
      .set("Idempotency-Key", idem("cross-ref-assessment-b"))
      .send({ riskId: riskIdA, likelihood: 2, impact: 2, controlEffectiveness: 0, conclusion: "tentative interorganisation" });
    expect(assessment.status).toBe(404);

    const control = await asOrg(request(app).post("/api/risks/controls"), "B")
      .set("Idempotency-Key", idem("cross-ref-control-b"))
      .send({ riskId: riskIdA, controlNumber: `CTRL-REF-B-${Date.now()}`, objective: "obj", description: "desc", ownerUserId: userB.id });
    expect(control.status).toBe(404);

    const treatmentCross = await asOrg(request(app).post("/api/risks/treatments"), "B")
      .set("Idempotency-Key", idem("cross-ref-treatment-b"))
      .send({ riskId: riskIdA, treatmentNumber: `TRT-REF-B-${Date.now()}`, strategy: "reduce", description: "desc", ownerUserId: userB.id });
    expect(treatmentCross.status).toBe(404);

    const review = await asOrg(request(app).post("/api/risks/reviews"), "B")
      .set("Idempotency-Key", idem("cross-ref-review-b"))
      .send({ riskId: riskIdA, reviewNumber: `REV-REF-B-${Date.now()}`, reviewerUserId: userB.id });
    expect(review.status).toBe(404);

    const incident = await asOrg(request(app).post("/api/risks/incidents"), "B")
      .set("Idempotency-Key", idem("cross-ref-incident-b"))
      .send({ riskId: riskIdA, incidentNumber: `INC-REF-B-${Date.now()}`, sourceType: "manual", title: "t", description: "d", ownerUserId: userB.id });
    expect(incident.status).toBe(404);

    // Même preuve côté résilience : un événement d'org A, org B tente d'y
    // rattacher une cellule de crise / décision / communication / entrée de
    // chronologie.
    const eventA = await asOrg(request(app).post("/api/resilience/events"), "A")
      .set("Idempotency-Key", idem("cross-ref-event-a"))
      .send({ eventType: "incident", title: "Panne org A", severity: "high", ownerUserId: userA.id, justification: "j", proofReference: "fixture://x" });
    const eventIdA = eventA.body.id;

    const crisisCell = await asOrg(request(app).post("/api/resilience/crisis-cells"), "B")
      .set("Idempotency-Key", idem("cross-ref-crisis-b"))
      .send({ eventId: eventIdA, leadUserId: userB.id, mandate: "m", proofReference: "fixture://x" });
    expect(crisisCell.status).toBe(404);

    const decision = await asOrg(request(app).post("/api/resilience/decisions"), "B")
      .set("Idempotency-Key", idem("cross-ref-decision-b"))
      .send({ eventId: eventIdA, authorUserId: userB.id, decision: "d", justification: "j", proofReference: "fixture://x" });
    expect(decision.status).toBe(404);

    const communication = await asOrg(request(app).post("/api/resilience/communications"), "B")
      .set("Idempotency-Key", idem("cross-ref-communication-b"))
      .send({ eventId: eventIdA, authorUserId: userB.id, approverUserId: userB.id + 999999, channel: "email", audience: "interne", message: "m", proofReference: "fixture://x" });
    expect(communication.status).toBe(404);

    const timeline = await asOrg(request(app).post("/api/resilience/timeline"), "B")
      .send({ eventId: eventIdA, entryType: "note", details: {} });
    expect(timeline.status).toBe(404);

    // Et côté gouvernance documentaire : une classification d'org A, org B
    // tente de créer un document dessus ; un document d'org A, org B tente
    // d'y ajouter une version ou une revue d'accès.
    const classificationA = await asOrg(request(app).post("/api/document-governance/classifications"), "A")
      .set("Idempotency-Key", idem("cross-ref-classification-a"))
      .send({ classificationCode: `CLS-REF-A-${Date.now()}`, name: "Interne", sensitivityLevel: "internal", ownerUserId: userA.id, evidence: ["fixture://x"] });
    const classificationIdA = classificationA.body.id;

    const documentCross = await asOrg(request(app).post("/api/document-governance/documents"), "B")
      .send({ classificationId: classificationIdA, documentCode: `DOC-REF-B-${Date.now()}`, title: "t", businessOwnerUserId: userB.id });
    expect(documentCross.status).toBe(404);

    const documentA = await asOrg(request(app).post("/api/document-governance/documents"), "A")
      .send({ classificationId: classificationIdA, documentCode: `DOC-REF-A-${Date.now()}`, title: "t", businessOwnerUserId: userA.id });
    const documentIdA = documentA.body.id;

    const versionCross = await asOrg(request(app).post(`/api/document-governance/documents/${documentIdA}/versions`), "B")
      .set("Idempotency-Key", idem("cross-ref-version-b"))
      .send({ versionNumber: 1, changeSummary: "s", contentHash: "sha256:x", storageRef: "fixture://x", preparedByUserId: userB.id });
    expect(versionCross.status).toBe(404);

    const accessReviewCross = await asOrg(request(app).post("/api/document-governance/access-reviews"), "B")
      .set("Idempotency-Key", idem("cross-ref-access-review-b"))
      .send({ documentId: documentIdA, reviewedByUserId: userB.id, reviewedAt: new Date().toISOString(), authorizedRoles: ["admin"], evidence: ["fixture://x"] });
    expect(accessReviewCross.status).toBe(404);
  });

  test("4. tâches et événements isolés — constats d'audit et événements de résilience", async () => {
    const engagementA = await asOrg(request(app).post("/api/internal-audit/engagements"), "A")
      .set("Idempotency-Key", idem("isolation-engagement-a"))
      .send({ engagementNumber: `ENG-ISO-A-${Date.now()}`, title: "Audit A", auditType: "compliance", objective: "o", leadAuditorUserId: userA.id, auditeeOwnerUserId: userA.id });
    const findingMarkerA = `FND-ISO-A-${Date.now()}`;
    await asOrg(request(app).post("/api/internal-audit/findings"), "A")
      .set("Idempotency-Key", idem("isolation-finding-a"))
      .send({ engagementId: engagementA.body.id, findingNumber: findingMarkerA, classification: "major", title: "t", description: "d", criterion: "c", ownerUserId: userA.id, evidence: ["fixture://x"] });

    const engagementB = await asOrg(request(app).post("/api/internal-audit/engagements"), "B")
      .set("Idempotency-Key", idem("isolation-engagement-b"))
      .send({ engagementNumber: `ENG-ISO-B-${Date.now()}`, title: "Audit B", auditType: "compliance", objective: "o", leadAuditorUserId: userB.id, auditeeOwnerUserId: userB.id });
    const findingMarkerB = `FND-ISO-B-${Date.now()}`;
    await asOrg(request(app).post("/api/internal-audit/findings"), "B")
      .set("Idempotency-Key", idem("isolation-finding-b"))
      .send({ engagementId: engagementB.body.id, findingNumber: findingMarkerB, classification: "major", title: "t", description: "d", criterion: "c", ownerUserId: userB.id, evidence: ["fixture://x"] });

    const findingsAsA = await asOrg(request(app).get("/api/internal-audit/findings"), "A");
    const findingsAsB = await asOrg(request(app).get("/api/internal-audit/findings"), "B");
    expect(findingsAsA.body.some((f) => f.finding_number === findingMarkerA)).toBe(true);
    expect(findingsAsA.body.some((f) => f.finding_number === findingMarkerB)).toBe(false);
    expect(findingsAsB.body.some((f) => f.finding_number === findingMarkerB)).toBe(true);
    expect(findingsAsB.body.some((f) => f.finding_number === findingMarkerA)).toBe(false);

    const eventMarkerA = `EVT-ISO-A-${Date.now()}`;
    await asOrg(request(app).post("/api/resilience/events"), "A")
      .set("Idempotency-Key", idem("isolation-event-a"))
      .send({ eventType: "incident", title: eventMarkerA, severity: "medium", ownerUserId: userA.id, justification: "j", proofReference: "fixture://x" });
    const eventMarkerB = `EVT-ISO-B-${Date.now()}`;
    await asOrg(request(app).post("/api/resilience/events"), "B")
      .set("Idempotency-Key", idem("isolation-event-b"))
      .send({ eventType: "incident", title: eventMarkerB, severity: "medium", ownerUserId: userB.id, justification: "j", proofReference: "fixture://x" });

    const eventsAsA = await asOrg(request(app).get("/api/resilience/events"), "A");
    const eventsAsB = await asOrg(request(app).get("/api/resilience/events"), "B");
    expect(eventsAsA.body.some((e) => e.title === eventMarkerA)).toBe(true);
    expect(eventsAsA.body.some((e) => e.title === eventMarkerB)).toBe(false);
    expect(eventsAsB.body.some((e) => e.title === eventMarkerB)).toBe(true);
    expect(eventsAsB.body.some((e) => e.title === eventMarkerA)).toBe(false);
  });

  test("5. sessions conservant la bonne organisation — le contexte vient de la session, jamais du client", async () => {
    // Ici on utilise le VRAI middleware requireOrganisation (pas le mock par
    // en-tête ci-dessus) : req.organisationId doit venir uniquement de
    // req.user.organisation_id posé par l'authentification, jamais d'une
    // valeur fournie dans le corps de la requête.
    jest.resetModules();
    const realExpress = require("express");
    const realRequest = require("supertest");
    const { requireOrganisation } = jest.requireActual("../middleware/organization.middleware");
    const realErrorHandler = jest.requireActual("../middleware/errorHandler");
    const realEnterpriseRiskRoutes = jest.requireActual("../routes/business/enterprise-risk.routes");

    function sessionAuth(req, _res, next) {
      // Simule une session authentifiée liée à orgA — indépendamment de ce
      // que le client prétend dans le corps de la requête.
      req.user = { id: userA.id, organisation_id: orgA.id, role: "admin" };
      next();
    }

    const realApp = realExpress();
    realApp.use(realExpress.json());
    realApp.use(sessionAuth);
    realApp.use("/api/risks", requireOrganisation, realEnterpriseRiskRoutes);
    realApp.use(realErrorHandler);

    const res = await realRequest(realApp)
      .post("/api/risks")
      .set("Idempotency-Key", idem("session-org-integrity"))
      .send({
        // Tentative malveillante : prétendre appartenir à orgB dans le corps.
        organisationId: orgB.id,
        riskNumber: `RISK-SESSION-${Date.now()}`,
        category: "operational",
        title: "Risque créé via session orgA",
        description: "desc",
        ownerUserId: userA.id,
        likelihood: 2,
        impact: 2,
      });
    expect(res.status).toBe(201);
    // La ligne créée doit appartenir à orgA (la session), pas à orgB (le corps).
    expect(String(res.body.organisation_id)).toBe(String(orgA.id));

    const raw = await db.query("SELECT organisation_id FROM enterprise_risks WHERE id=$1", [res.body.id]);
    expect(String(raw.rows[0].organisation_id)).toBe(String(orgA.id));
    expect(String(raw.rows[0].organisation_id)).not.toBe(String(orgB.id));
  });
});
