/**
 * Issue #175 (Étage 7) PR D — concurrence et idempotence.
 *
 * Comme pour les PR B et C, `test/stage7-concurrency-idempotency` (déjà dans
 * le repo) partage la même lignée git divergente inexploitable — écrit à
 * neuf sur `main` actuel.
 *
 * Constat fait en écrivant cette preuve — deux bugs réels, corrigés dans ce
 * commit avant d'écrire les tests ci-dessous (sinon ils auraient échoué) :
 *
 * 1. Rejeu d'une même Idempotency-Key (reprise après interruption réseau) ou
 *    double soumission concurrente : la contrainte UNIQUE(organisation_id,
 *    idempotency_key) empêchait déjà la ligne en double au niveau base de
 *    données (aucune régression de sécurité), mais l'erreur Postgres brute
 *    (23505, texte de la contrainte) remontait telle quelle en 500 générique
 *    — le client ne pouvait pas distinguer "conflit attendu, relance en toute
 *    sécurité" d'une vraie panne serveur, et le nom interne de la contrainte
 *    fuitait. Corrigé dans `errorHandler.js` (mapping 23505 → 409 structuré).
 *
 * 2. Double approbation/publication/exécution : plusieurs routes de
 *    transition (budget.approve, forecast.publish, scenario.approve,
 *    document.publish, retention.execute, resilience.improvement.close,
 *    enterprise-risk control/treatment/review transitions) ne vérifiaient
 *    JAMAIS le statut courant de la ressource avant d'appliquer la
 *    transition — seule son existence était vérifiée. Un budget déjà
 *    approuvé pouvait être ré-approuvé (silencieusement, sans erreur),
 *    écrasant l'approbation précédente. Corrigé en appliquant l'utilitaire
 *    `checkBlockClosure` (déjà utilisé par `internal-audit.routes.js`, pas
 *    une nouvelle logique) à ces routes.
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
const advancedFinancialManagementRoutes = require("../routes/business/advanced-financial-management.routes");
const errorHandler = require("../middleware/errorHandler");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/risks", enterpriseRiskRoutes);
  app.use("/api/finance", advancedFinancialManagementRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function idem(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Étage 7 PR D — concurrence et idempotence", () => {
  let org, owner, approver;

  beforeAll(async () => {
    org = await createTestOrganisation({ nom: `Stage7 PR D ${Date.now()}` });
    owner = await createTestUser({ organisation_id: org.id, role: "admin" });
    approver = await createTestUser({ organisation_id: org.id, role: "admin" });
    mockState.organisationId = org.id;
  });

  afterAll(async () => {
    await db.query("DELETE FROM utilisateurs WHERE id = ANY($1)", [[owner?.id, approver?.id].filter(Boolean)]);
    await db.query("DELETE FROM organisations WHERE id = $1", [org.id]);
  });

  test("1. reprise après interruption réseau — rejeu de la même Idempotency-Key rejeté proprement, aucune ligne dupliquée", async () => {
    const key = idem("network-retry");
    const payload = { riskNumber: `RISK-RETRY-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 };

    const first = await request(app).post("/api/risks").set("Idempotency-Key", key).send(payload);
    expect(first.status).toBe(201);

    // Le client n'a pas reçu la réponse (coupure réseau simulée) et relance
    // exactement la même requête avec la même clé. Le corps étant identique,
    // Postgres peut signaler soit la contrainte métier (risk_number), soit
    // celle d'idempotence — les deux protègent contre la duplication, seul
    // le code renvoyé diffère.
    const retry = await request(app).post("/api/risks").set("Idempotency-Key", key).send(payload);
    expect(retry.status).toBe(409);
    // res.apiResponse expose l'enveloppe ApiResponse brute (voir src/test/setup.js) ;
    // res.body est déjà déballé sur son sous-objet `errors` par convention du repo.
    expect(["IDEMPOTENCY_KEY_ALREADY_USED", "UNIQUE_CONSTRAINT_VIOLATION"]).toContain(retry.apiResponse.code);
    // Le message ne doit jamais exposer le texte brut Postgres (nom de contrainte, table).
    expect(retry.body.message).not.toMatch(/constraint|enterprise_risks/i);

    const count = await db.query("SELECT COUNT(*)::int AS c FROM enterprise_risks WHERE idempotency_key=$1", [key]);
    expect(count.rows[0].c).toBe(1);
  });

  test("1b. rejeu de la même Idempotency-Key avec un contenu métier différent — code d'idempotence spécifique", async () => {
    const key = idem("network-retry-idem-specific");
    const first = await request(app).post("/api/risks").set("Idempotency-Key", key).send({ riskNumber: `RISK-IDEM-A-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 });
    expect(first.status).toBe(201);

    const conflict = await request(app).post("/api/risks").set("Idempotency-Key", key).send({ riskNumber: `RISK-IDEM-B-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 });
    expect(conflict.status).toBe(409);
    expect(conflict.apiResponse.code).toBe("IDEMPOTENCY_KEY_ALREADY_USED");
  });

  test("2. transitions concurrentes — deux requêtes simultanées avec la même Idempotency-Key ne créent qu'une seule ressource", async () => {
    const key = idem("concurrent-create");
    const payload = { riskNumber: `RISK-CONC-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 };

    const [a, b] = await Promise.all([
      request(app).post("/api/risks").set("Idempotency-Key", key).send(payload),
      request(app).post("/api/risks").set("Idempotency-Key", key).send(payload),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await db.query("SELECT COUNT(*)::int AS c FROM enterprise_risks WHERE idempotency_key=$1", [key]);
    expect(count.rows[0].c).toBe(1);
  });

  test("3. double approbation refusée — un budget déjà approuvé ne peut pas être réapprouvé", async () => {
    const budget = await request(app)
      .post("/api/finance/budgets")
      .set("Idempotency-Key", idem("budget-create"))
      .send({
        budgetNumber: `BUD-DBL-${Date.now()}`,
        name: "Budget test double approbation",
        fiscalYear: 2026,
        ownerUserId: owner.id,
        totalRevenue: 100000,
        totalExpense: 80000,
        allocations: [{ department: "ops", amount: 80000 }],
        assumptions: ["hypothèse test"],
      });
    expect(budget.status).toBe(201);
    const budgetId = budget.body.id;

    const firstApproval = await request(app)
      .post(`/api/finance/budgets/${budgetId}/approve`)
      .set("Idempotency-Key", idem("budget-approve-1"))
      .send({ approvedByUserId: approver.id, approvalEvidence: ["fixture://comite-1.pdf"] });
    expect(firstApproval.status).toBe(200);
    expect(firstApproval.body.status).toBe("approved");

    // Deuxième tentative d'approbation sur un budget déjà approuvé — même en
    // changeant l'approbateur/la preuve, elle doit être refusée (409), pas
    // silencieusement acceptée en écrasant la première approbation.
    const secondApproval = await request(app)
      .post(`/api/finance/budgets/${budgetId}/approve`)
      .set("Idempotency-Key", idem("budget-approve-2"))
      .send({ approvedByUserId: owner.id, approvalEvidence: ["fixture://comite-2.pdf"] });
    expect(secondApproval.status).toBe(409);
    expect(secondApproval.body.code).toBe("block_closure.resource_final");

    const stored = await db.query("SELECT approved_by_user_id, approval_evidence FROM financial_budgets WHERE id=$1", [budgetId]);
    // L'approbation d'origine n'a pas été écrasée par la seconde tentative.
    expect(String(stored.rows[0].approved_by_user_id)).toBe(String(approver.id));
  });

  test("4. double enregistrement (paiement/position de trésorerie) refusé au rejeu de la même clé", async () => {
    const key = idem("cash-position");
    const payload = {
      positionDate: new Date().toISOString().slice(0, 10),
      accountReference: `ACC-DBL-${Date.now()}`,
      openingBalance: 1000,
      inflows: 500,
      outflows: 200,
      closingBalance: 1300,
      preparedByUserId: owner.id,
      sourceEvidence: ["fixture://releve.pdf"],
    };

    const first = await request(app).post("/api/finance/cash-positions").set("Idempotency-Key", key).send(payload);
    expect(first.status).toBe(201);

    const replay = await request(app).post("/api/finance/cash-positions").set("Idempotency-Key", key).send(payload);
    expect(replay.status).toBe(409);
    expect(["IDEMPOTENCY_KEY_ALREADY_USED", "UNIQUE_CONSTRAINT_VIOLATION"]).toContain(replay.apiResponse.code);

    const count = await db.query("SELECT COUNT(*)::int AS c FROM financial_cash_positions WHERE idempotency_key=$1", [key]);
    expect(count.rows[0].c).toBe(1);
  });

  test("5. transition concurrente sur une même ressource (deux tentatives simultanées de clôturer le même traitement de risque)", async () => {
    const risk = await request(app)
      .post("/api/risks")
      .set("Idempotency-Key", idem("risk-for-treatment"))
      .send({ riskNumber: `RISK-TRT-CONC-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 });
    const treatment = await request(app)
      .post("/api/risks/treatments")
      .set("Idempotency-Key", idem("treatment-for-conc"))
      .send({ riskId: risk.body.id, treatmentNumber: `TRT-CONC-${Date.now()}`, strategy: "reduce", description: "d", ownerUserId: owner.id });
    const treatmentId = treatment.body.id;

    // Deux appels concurrents tentent tous deux de clôturer le même traitement.
    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/risks/treatments/${treatmentId}/transition`)
        .set("Idempotency-Key", idem("treatment-close-a"))
        .send({ action: "closed", result: "ok", evidence: ["fixture://a.pdf"] }),
      request(app)
        .post(`/api/risks/treatments/${treatmentId}/transition`)
        .set("Idempotency-Key", idem("treatment-close-b"))
        .send({ action: "closed", result: "ok", evidence: ["fixture://b.pdf"] }),
    ]);
    const statuses = [a.status, b.status].sort();
    // L'un des deux réussit (200), l'autre trouve la ressource déjà fermée (409) —
    // jamais les deux à 200 (ce qui indiquerait une double clôture non détectée).
    expect(statuses).toEqual([200, 409]);

    const final = await db.query("SELECT status FROM enterprise_risk_treatments WHERE id=$1", [treatmentId]);
    expect(final.rows[0].status).toBe("closed");
  });
});
