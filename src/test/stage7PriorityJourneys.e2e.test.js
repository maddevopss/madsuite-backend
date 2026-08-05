/**
 * Issue #175 (Étage 7) PR B — parcours de bout en bout prioritaires.
 *
 * Les branches précédemment poussées pour l'Étage 7 (test/stage7-*, ops/stage7-*,
 * docs/stage7-*) partagent leur commit racine avec `main` mais ont ensuite divergé
 * sur une lignée totalement différente (990 commits, 626 fichiers, aucune base de
 * fusion utilisable) — inexploitables. Ce fichier repart de zéro sur `main` actuel.
 *
 * Preuve réelle (requêtes HTTP + PostgreSQL, pas de lecture de source) des 5
 * parcours prioritaires listés dans l'issue, chacun de bout en bout via les
 * routes métier existantes :
 *   1. risque → traitement → revue
 *   2. incident → continuité → décision → leçon
 *   3. audit → action corrective → vérification
 *   4. budget → approbation → suivi
 *   5. document → version → publication → conservation
 *
 * Constat fait en écrivant ces preuves : les policies de séparation des tâches
 * (budget, version de document, exécution de rétention) exigent des acteurs
 * distincts pour la préparation/l'approbation/l'exécution — deux/trois
 * utilisateurs de test distincts sont donc nécessaires par organisation.
 */
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
const institutionalResilienceRoutes = require("../routes/business/institutional-resilience.routes");
const internalAuditRoutes = require("../routes/business/internal-audit.routes");
const advancedFinancialManagementRoutes = require("../routes/business/advanced-financial-management.routes");
const advancedDocumentGovernanceRoutes = require("../routes/business/advanced-document-governance.routes");
const errorHandler = require("../middleware/errorHandler");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/risks", enterpriseRiskRoutes);
  app.use("/api/resilience", institutionalResilienceRoutes);
  app.use("/api/internal-audit", internalAuditRoutes);
  app.use("/api/finance", advancedFinancialManagementRoutes);
  app.use("/api/document-governance", advancedDocumentGovernanceRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function idem(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Étage 7 PR B — parcours de bout en bout prioritaires", () => {
  let org;
  let owner;
  let approver;
  let executor;

  beforeAll(async () => {
    org = await createTestOrganisation({ nom: `Stage7 PR B ${Date.now()}` });
    owner = await createTestUser({ organisation_id: org.id, role: "admin" });
    approver = await createTestUser({ organisation_id: org.id, role: "admin" });
    executor = await createTestUser({ organisation_id: org.id, role: "admin" });
    mockState.organisationId = org.id;
  });

  afterAll(async () => {
    // organisations -> utilisateurs est ON DELETE SET NULL ; chk_org_context
    // interdit organisation_id NULL sur un utilisateur non soft-supprimé.
    // Les utilisateurs de test doivent donc être supprimés avant l'organisation.
    await db.query("DELETE FROM utilisateurs WHERE id = ANY($1)", [
      [owner?.id, approver?.id, executor?.id].filter(Boolean),
    ]);
    await db.query("DELETE FROM organisations WHERE id = $1", [org.id]);
  });

  test("1. risque → traitement → revue", async () => {
    const risk = await request(app)
      .post("/api/risks")
      .set("Idempotency-Key", idem("risk-create"))
      .send({
        riskNumber: `RISK-${Date.now()}`,
        category: "operational",
        title: "Interruption fournisseur critique",
        description: "Dépendance unique non doublée",
        ownerUserId: owner.id,
        likelihood: 3,
        impact: 4,
      });
    expect(risk.status).toBe(201);
    const riskId = risk.body.id;

    const treatment = await request(app)
      .post("/api/risks/treatments")
      .set("Idempotency-Key", idem("risk-treatment"))
      .send({
        riskId,
        treatmentNumber: `TRT-${Date.now()}`,
        strategy: "reduce",
        description: "Qualifier un second fournisseur",
        ownerUserId: owner.id,
        dueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
    expect(treatment.status).toBe(201);
    expect(treatment.body.risk_id).toBe(riskId);

    const review = await request(app)
      .post("/api/risks/reviews")
      .set("Idempotency-Key", idem("risk-review"))
      .send({
        riskId,
        reviewNumber: `REV-${Date.now()}`,
        reviewerUserId: owner.id,
        likelihood: 2,
        impact: 4,
        residualScore: 8,
        conclusion: "Risque réduit par le second fournisseur, à surveiller",
        status: "draft",
      });
    expect(review.status).toBe(201);
    expect(review.body.risk_id).toBe(riskId);
  });

  test("2. incident → continuité (cellule de crise) → décision → leçon", async () => {
    const incident = await request(app)
      .post("/api/resilience/events")
      .set("Idempotency-Key", idem("resilience-event"))
      .send({
        eventType: "incident",
        title: "Panne datacenter primaire",
        severity: "high",
        ownerUserId: owner.id,
        justification: "Coupure électrique majeure confirmée par le fournisseur",
        proofReference: "fixture://event-justification",
      });
    expect(incident.status).toBe(201);
    const eventId = incident.body.id;

    const crisisCell = await request(app)
      .post("/api/resilience/crisis-cells")
      .set("Idempotency-Key", idem("resilience-crisis"))
      .send({
        eventId,
        leadUserId: owner.id,
        mandate: "Coordonner le basculement vers le site secondaire",
        proofReference: "fixture://crisis-cell-mandate",
      });
    expect(crisisCell.status).toBe(201);
    expect(crisisCell.body.event_id).toBe(eventId);

    const decision = await request(app)
      .post("/api/resilience/decisions")
      .set("Idempotency-Key", idem("resilience-decision"))
      .send({
        eventId,
        authorUserId: owner.id,
        decision: "Basculer vers le site secondaire",
        justification: "RTO dépassé sur le primaire",
        proofReference: "fixture://decision-record",
      });
    expect(decision.status).toBe(201);
    expect(decision.body.event_id).toBe(eventId);

    const lesson = await request(app)
      .post("/api/resilience/lessons")
      .set("Idempotency-Key", idem("resilience-lesson"))
      .send({
        sourceType: "incident",
        sourceId: String(eventId),
        lesson: "Le basculement manuel a pris 40 minutes de plus que prévu",
        impact: "Réviser le runbook de bascule",
        ownerUserId: owner.id,
        proofReference: "fixture://lesson-record",
      });
    expect(lesson.status).toBe(201);
    expect(lesson.body.source_id).toBe(String(eventId));
  });

  test("3. audit → constat → action corrective → vérification", async () => {
    const engagement = await request(app)
      .post("/api/internal-audit/engagements")
      .set("Idempotency-Key", idem("audit-engagement"))
      .send({
        engagementNumber: `ENG-${Date.now()}`,
        title: "Audit des accès privilégiés",
        auditType: "compliance",
        objective: "Vérifier la révocation des accès des ex-employés",
        leadAuditorUserId: owner.id,
        auditeeOwnerUserId: owner.id,
      });
    expect(engagement.status).toBe(201);
    const engagementId = engagement.body.id;

    const finding = await request(app)
      .post("/api/internal-audit/findings")
      .set("Idempotency-Key", idem("audit-finding"))
      .send({
        engagementId,
        findingNumber: `FND-${Date.now()}`,
        classification: "major",
        title: "3 comptes ex-employés encore actifs",
        description: "Détectés lors du rapprochement RH/IAM",
        criterion: "Politique de désactivation sous 24h",
        ownerUserId: owner.id,
        dueAt: new Date(Date.now() + 14 * 86400000).toISOString(),
        evidence: ["fixture://rapprochement-rh-iam.csv"],
      });
    expect(finding.status).toBe(201);
    const findingId = finding.body.id;
    expect(finding.body.engagement_id).toBe(engagementId);

    const action = await request(app)
      .post("/api/internal-audit/actions")
      .set("Idempotency-Key", idem("audit-action"))
      .send({
        findingId,
        actionNumber: `ACT-${Date.now()}`,
        description: "Désactiver les 3 comptes et automatiser le contrôle mensuel",
        ownerUserId: owner.id,
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    expect(action.status).toBe(201);
    expect(action.body.finding_id).toBe(findingId);

    const followup = await request(app)
      .post("/api/internal-audit/followups")
      .set("Idempotency-Key", idem("audit-followup"))
      .send({
        engagementId,
        followupNumber: `FUP-${Date.now()}`,
        reviewerUserId: owner.id,
        conclusion: "Comptes désactivés, contrôle mensuel automatisé vérifié en place",
        residualRisk: "low",
        evidence: ["fixture://verification-controle-mensuel.png"],
      });
    expect(followup.status).toBe(201);
    expect(followup.body.engagement_id).toBe(engagementId);
  });

  test("4. budget → approbation → suivi (position de trésorerie)", async () => {
    const budget = await request(app)
      .post("/api/finance/budgets")
      .set("Idempotency-Key", idem("finance-budget"))
      .send({
        budgetNumber: `BUD-${Date.now()}`,
        name: "Budget opérationnel FY26",
        fiscalYear: 2026,
        ownerUserId: owner.id,
        totalRevenue: 500000,
        totalExpense: 420000,
        allocations: [{ department: "operations", amount: 300000 }],
        assumptions: ["Croissance stable du portefeuille clients"],
      });
    expect(budget.status).toBe(201);
    const budgetId = budget.body.id;
    expect(budget.body.status).toBe("draft");

    // Séparation des tâches: l'approbateur doit différer du propriétaire du budget.
    const approval = await request(app)
      .post(`/api/finance/budgets/${budgetId}/approve`)
      .set("Idempotency-Key", idem("finance-budget-approve"))
      .send({ approvedByUserId: approver.id, approvalEvidence: ["fixture://comite-budgetaire-pv.pdf"] });
    expect(approval.status).toBe(200);
    expect(approval.body.status).toBe("approved");

    const cashPosition = await request(app)
      .post("/api/finance/cash-positions")
      .set("Idempotency-Key", idem("finance-cash-position"))
      .send({
        positionDate: new Date().toISOString().slice(0, 10),
        accountReference: "OPEX-MAIN",
        openingBalance: 100000,
        inflows: 20000,
        outflows: 15000,
        closingBalance: 105000,
        preparedByUserId: owner.id,
        sourceEvidence: ["fixture://releve-bancaire.pdf"],
      });
    expect(cashPosition.status).toBe(201);
    expect(Number(cashPosition.body.closing_balance)).toBe(105000);
  });

  test("5. document → version → publication → conservation", async () => {
    const classification = await request(app)
      .post("/api/document-governance/classifications")
      .set("Idempotency-Key", idem("document-classification"))
      .send({
        classificationCode: `CLS-${Date.now()}`,
        name: "Politiques internes",
        sensitivityLevel: "internal",
        retentionYears: 7,
        ownerUserId: owner.id,
        evidence: ["fixture://classification-schema.pdf"],
      });
    expect(classification.status).toBe(201);
    const classificationId = classification.body.id;

    const document = await request(app)
      .post("/api/document-governance/documents")
      .send({
        classificationId,
        documentCode: `DOC-${Date.now()}`,
        title: "Politique de rétention des données clients",
        businessOwnerUserId: owner.id,
      });
    expect(document.status).toBe(201);
    const documentId = document.body.id;
    expect(document.body.status).toBe("draft");

    // Séparation des tâches: préparateur et approbateur de version doivent différer.
    const version = await request(app)
      .post(`/api/document-governance/documents/${documentId}/versions`)
      .set("Idempotency-Key", idem("document-version"))
      .send({
        versionNumber: 1,
        changeSummary: "Version initiale approuvée par le comité de gouvernance",
        contentHash: "sha256:fixture-hash",
        storageRef: "fixture://document-store/v1",
        preparedByUserId: owner.id,
        approvedByUserId: approver.id,
        approvedAt: new Date().toISOString(),
        evidence: ["fixture://comite-gouvernance-pv.pdf"],
      });
    expect(version.status).toBe(201);
    const versionId = version.body.id;
    expect(version.body.document_id).toBe(documentId);

    const publish = await request(app)
      .post(`/api/document-governance/documents/${documentId}/publish`)
      .set("Idempotency-Key", idem("document-publish"))
      .send({
        approvedVersionId: versionId,
        publishedByUserId: owner.id,
        effectiveAt: new Date().toISOString(),
        evidence: ["fixture://publication-intranet.png"],
      });
    expect(publish.status).toBe(200);
    expect(publish.body.status).toBe("published");

    const retentionAction = await request(app)
      .post("/api/document-governance/retention-actions")
      .set("Idempotency-Key", idem("document-retention"))
      .send({
        documentId,
        actionType: "archive",
        scheduledAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        requestedByUserId: owner.id,
        reason: "Fin du cycle de vie actif, conservation légale de 7 ans",
      });
    expect(retentionAction.status).toBe(201);
    const retentionActionId = retentionAction.body.id;
    expect(retentionAction.body.status).toBe("pending");

    // Séparation des tâches: demandeur, approbateur et exécutant tous distincts.
    const execute = await request(app)
      .post(`/api/document-governance/retention-actions/${retentionActionId}/execute`)
      .set("Idempotency-Key", idem("document-retention-execute"))
      .send({
        approvedByUserId: approver.id,
        executedByUserId: executor.id,
        evidence: ["fixture://archivage-confirme.pdf"],
      });
    expect(execute.status).toBe(200);
    expect(execute.body.status).toBe("executed");
  });
});
