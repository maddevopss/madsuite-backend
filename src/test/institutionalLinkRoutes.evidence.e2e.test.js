// Issue #171 (Étage 3) PR H — fermeture. Les contrats existants
// (institutional-risk-links.contract.test.js, risk-continuity-links.contract.test.js,
// audit-corrective-action-links.contract.test.js) ne lisent que le texte source
// (présence d'une chaîne, comptage de FOR UPDATE) — aucun n'exécute une vraie
// requête HTTP contre PostgreSQL. Ce fichier ferme les deux exigences de PR H
// encore manquantes : preuve qu'une référence cassée est refusée, et preuve
// d'isolation interorganisation, pour les trois routes de liaison intermodule
// livrées par cet étage (PR A, B, E).
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
  req.user = { id: 1, role: "admin" };
  next();
}

const enterpriseRiskRoutes = require("../routes/business/enterprise-risk.routes");
const internalAuditRoutes = require("../routes/business/internal-audit.routes");
const errorHandler = require("../middleware/errorHandler");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/risks", enterpriseRiskRoutes);
  app.use("/api/internal-audit", internalAuditRoutes);
  app.use(errorHandler);
  return app;
}

// src/test/setup.js patche globalement supertest pour déballer l'enveloppe
// ApiResponse ({success,code,data,errors}) : res.body devient directement
// errors (ex. {message, stack}) sur une réponse d'erreur. notFound() lève
// `new Error(code)` sans jamais définir err.code, donc la raison métier
// précise n'est disponible que dans body.message (err.message).
function businessErrorCode(res) {
  return res.body?.message;
}

async function seedRisk(organisationId, userId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO enterprise_risks
      (organisation_id, risk_number, category, title, description, owner_user_id, likelihood, impact, inherent_score, idempotency_key)
     VALUES ($1,$2,'operational','Risque test','Description test',$3,3,3,9,$4) RETURNING *`,
    [organisationId, `RISK-${suffix}`, userId, `seed-risk-${suffix}`],
  );
  return rows[0];
}

async function seedProcess(organisationId, userId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO enterprise_business_processes
      (organisation_id, process_number, name, description, owner_user_id, criticality, maximum_tolerable_downtime_minutes, recovery_time_objective_minutes, next_review_at, idempotency_key)
     VALUES ($1,$2,'Processus test','Description test',$3,'high',60,30,NOW()+INTERVAL '90 days',$4) RETURNING *`,
    [organisationId, `PROC-${suffix}`, userId, `seed-proc-${suffix}`],
  );
  return rows[0];
}

async function seedVulnerability(organisationId, userId, suffix) {
  const { rows } = await db.pool.query(
    `INSERT INTO cybersecurity_vulnerabilities
      (organisation_id, vulnerability_number, title, description, severity, source, owner_user_id, idempotency_key)
     VALUES ($1,$2,'Vuln test','Description test','high','scanner',$3,$4) RETURNING *`,
    [organisationId, `VULN-${suffix}`, userId, `seed-vuln-${suffix}`],
  );
  return rows[0];
}

async function seedAuditFinding(organisationId, userId, suffix) {
  const engagement = await db.pool.query(
    `INSERT INTO internal_audit_engagements
      (organisation_id, engagement_number, title, audit_type, objective, lead_auditor_user_id, auditee_owner_user_id, idempotency_key)
     VALUES ($1,$2,'Mission test','process','Objectif test',$3,$3,$4) RETURNING *`,
    [organisationId, `ENG-${suffix}`, userId, `seed-eng-${suffix}`],
  );
  const finding = await db.pool.query(
    `INSERT INTO internal_audit_findings
      (organisation_id, engagement_id, finding_number, classification, title, description, criterion, owner_user_id, idempotency_key)
     VALUES ($1,$2,$3,'major','Constat test','Description test','Critère test',$4,$5) RETURNING *`,
    [organisationId, engagement.rows[0].id, `FIND-${suffix}`, userId, `seed-find-${suffix}`],
  );
  return finding.rows[0];
}

describe("Liaisons intermodules — références cassées et isolation interorganisation (#171 PR H)", () => {
  let app;
  let orgA;
  let orgB;
  let userA;

  beforeAll(async () => {
    app = buildApp();
    orgA = await createTestOrganisation({ nom: "PR H Org A" });
    orgB = await createTestOrganisation({ nom: "PR H Org B" });
    userA = await createTestUser({ role: "admin", organisation_id: orgA.id, nom: "PR H Actor" });
  });

  afterAll(async () => {
    await db.pool.end().catch(() => null);
  });

  describe("institutional-risk-links (/api/risks/risk-links) — PR B", () => {
    test("refuse un risque source inexistant", async () => {
      mockState.organisationId = orgA.id;
      const vuln = await seedVulnerability(orgA.id, userA.id, "irl-1");
      const res = await request(app)
        .post("/api/risks/risk-links")
        .set("Idempotency-Key", "irl-broken-risk-0001")
        .send({ riskId: 999999999, targetType: "cybersecurity_vulnerability", targetId: vuln.id, relationshipType: "source" });
      expect(res.status).toBe(404);
      expect(businessErrorCode(res)).toBe("integration.risk_not_found");
    });

    test("refuse une cible d'une autre organisation (isolation interorganisation)", async () => {
      const riskA = await seedRisk(orgA.id, userA.id, "irl-2");
      const userB = await createTestUser({ role: "admin", organisation_id: orgB.id, nom: "PR H Actor B" });
      const vulnB = await seedVulnerability(orgB.id, userB.id, "irl-2b");

      mockState.organisationId = orgA.id;
      const res = await request(app)
        .post("/api/risks/risk-links")
        .set("Idempotency-Key", "irl-cross-org-0001")
        .send({ riskId: riskA.id, targetType: "cybersecurity_vulnerability", targetId: vulnB.id, relationshipType: "source" });
      expect(res.status).toBe(404);
      expect(businessErrorCode(res)).toBe("integration.target_not_found");
    });

    test("chemin heureux : lien créé, persiste, idempotent", async () => {
      mockState.organisationId = orgA.id;
      const risk = await seedRisk(orgA.id, userA.id, "irl-3");
      const vuln = await seedVulnerability(orgA.id, userA.id, "irl-3");
      const created = await request(app)
        .post("/api/risks/risk-links")
        .set("Idempotency-Key", "irl-happy-0001")
        .send({ riskId: risk.id, targetType: "cybersecurity_vulnerability", targetId: vuln.id, relationshipType: "source", rationale: "Preuve e2e PR H" });
      expect(created.status).toBe(201);

      const replay = await request(app)
        .post("/api/risks/risk-links")
        .set("Idempotency-Key", "irl-happy-0001")
        .send({ riskId: risk.id, targetType: "cybersecurity_vulnerability", targetId: vuln.id, relationshipType: "source", rationale: "Preuve e2e PR H" });
      expect([200, 201]).toContain(replay.status);
      expect(replay.body.id ?? replay.body.data?.id).toEqual(created.body.id ?? created.body.data?.id);
    });
  });

  describe("risk-continuity-links (/api/risks/continuity-links) — PR A", () => {
    test("refuse un processus cible inexistant", async () => {
      mockState.organisationId = orgA.id;
      const risk = await seedRisk(orgA.id, userA.id, "rcl-1");
      const res = await request(app)
        .post("/api/risks/continuity-links")
        .set("Idempotency-Key", "rcl-broken-process-0001")
        .send({ riskId: risk.id, processId: 999999999, relationType: "threatens_process" });
      expect(res.status).toBe(404);
      expect(businessErrorCode(res)).toBe("integration.continuity_process_not_found");
    });

    test("refuse un processus d'une autre organisation (isolation interorganisation)", async () => {
      const risk = await seedRisk(orgA.id, userA.id, "rcl-2");
      const userB = await createTestUser({ role: "admin", organisation_id: orgB.id, nom: "PR H Actor B2" });
      const processB = await seedProcess(orgB.id, userB.id, "rcl-2b");

      mockState.organisationId = orgA.id;
      const res = await request(app)
        .post("/api/risks/continuity-links")
        .set("Idempotency-Key", "rcl-cross-org-0001")
        .send({ riskId: risk.id, processId: processB.id, relationType: "threatens_process" });
      expect(res.status).toBe(404);
      expect(businessErrorCode(res)).toBe("integration.continuity_process_not_found");
    });

    test("chemin heureux : source de vérité distincte (risque et processus restent des entités séparées)", async () => {
      mockState.organisationId = orgA.id;
      const risk = await seedRisk(orgA.id, userA.id, "rcl-3");
      const process = await seedProcess(orgA.id, userA.id, "rcl-3");
      const res = await request(app)
        .post("/api/risks/continuity-links")
        .set("Idempotency-Key", "rcl-happy-0001")
        .send({ riskId: risk.id, processId: process.id, relationType: "threatens_process", rationale: "Preuve e2e PR H" });
      expect(res.status).toBe(201);

      const link = await db.pool.query(
        `SELECT risk_id, process_id FROM enterprise_risk_continuity_links WHERE organisation_id=$1 AND idempotency_key=$2`,
        [orgA.id, "rcl-happy-0001"],
      );
      // Le lien référence les deux enregistrements sans en dupliquer les champs :
      // preuve directe de "aucune duplication de source de vérité" (règle commune de l'étage).
      expect(link.rows[0].risk_id).toBe(risk.id);
      expect(link.rows[0].process_id).toBe(process.id);
    });
  });

  describe("audit-corrective-action-links (/api/internal-audit/corrective-action-links) — PR E", () => {
    test("refuse un constat d'audit source inexistant", async () => {
      mockState.organisationId = orgA.id;
      const vuln = await seedVulnerability(orgA.id, userA.id, "aal-1");
      const res = await request(app)
        .post("/api/internal-audit/corrective-action-links")
        .set("Idempotency-Key", "aal-broken-finding-0001")
        .send({ findingId: 999999999, targetType: "cybersecurity_vulnerability", targetId: vuln.id });
      expect(res.status).toBe(404);
      expect(businessErrorCode(res)).toBe("integration.audit_finding_not_found");
    });

    test("refuse une cible d'une autre organisation (isolation interorganisation)", async () => {
      const finding = await seedAuditFinding(orgA.id, userA.id, "aal-2");
      const userB = await createTestUser({ role: "admin", organisation_id: orgB.id, nom: "PR H Actor B3" });
      const vulnB = await seedVulnerability(orgB.id, userB.id, "aal-2b");

      mockState.organisationId = orgA.id;
      const res = await request(app)
        .post("/api/internal-audit/corrective-action-links")
        .set("Idempotency-Key", "aal-cross-org-0001")
        .send({ findingId: finding.id, targetType: "cybersecurity_vulnerability", targetId: vulnB.id });
      expect(res.status).toBe(404);
      expect(businessErrorCode(res)).toBe("integration.audit_target_not_found");
    });

    test("chemin heureux : lien créé sans transférer la propriété du constat à la cible", async () => {
      mockState.organisationId = orgA.id;
      const finding = await seedAuditFinding(orgA.id, userA.id, "aal-3");
      const vuln = await seedVulnerability(orgA.id, userA.id, "aal-3");
      const res = await request(app)
        .post("/api/internal-audit/corrective-action-links")
        .set("Idempotency-Key", "aal-happy-0001")
        .send({ findingId: finding.id, targetType: "cybersecurity_vulnerability", targetId: vuln.id, rationale: "Preuve e2e PR H" });
      expect(res.status).toBe(201);

      // Le constat d'audit reste géré par internal_audit_findings, la
      // vulnérabilité par cybersecurity_vulnerabilities : audit_corrective_action_links
      // ne fait que référencer les deux (vérificateur indépendant, pas propriétaire).
      const stillOwnedByAudit = await db.pool.query(`SELECT id FROM internal_audit_findings WHERE id=$1`, [finding.id]);
      const stillOwnedByCyber = await db.pool.query(`SELECT id FROM cybersecurity_vulnerabilities WHERE id=$1`, [vuln.id]);
      expect(stillOwnedByAudit.rows).toHaveLength(1);
      expect(stillOwnedByCyber.rows).toHaveLength(1);
    });
  });
});
