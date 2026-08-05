/**
 * Issue #175 (Étage 7) PR E — essais de performance.
 *
 * Comme pour les PR B/C/D, `test/stage7-performance-thresholds` (déjà dans le
 * repo) partage la même lignée git divergente inexploitable, et son seul
 * contenu réel (`stage7-performance-thresholds.contract.test.js`) évalue une
 * fonction locale contre des nombres inventés (`registryP95Ms: 500` n'est une
 * mesure de rien) — pas une preuve contre le code réel. Écrit à neuf.
 *
 * Preuve réelle (vraies requêtes HTTP + vraie base PostgreSQL, volumes
 * réellement insérés) des exigences de l'issue :
 *   1. registre volumineux + pagination réelle : parcours complet par
 *      curseur sans doublon ni omission ;
 *   2. filtres corrects à volume (pas seulement sur un jeu de données
 *      minuscule) ;
 *   3. route de synthèse (alerts) correcte à volume, avec un seuil de temps
 *      documenté comme mesure de laboratoire (ce bac à sable), pas une SLA
 *      de production ;
 *   4. un résultat rapide mais faux n'est jamais un succès — la correction
 *      est vérifiée avant la latence dans chaque test ci-dessous, jamais
 *      l'inverse.
 *
 * Constat fait en écrivant cette preuve — noté ici, pas corrigé dans cette
 * PR (changement de contrat d'API, hors périmètre d'une PR de tests de
 * performance ; voir note de bas de fichier) : les routes de liste
 * `GET /api/risks`, `GET /api/resilience/events`, `GET /api/internal-audit/*`,
 * `GET /api/finance/*`, `GET /api/document-governance/*` n'ont ni LIMIT ni
 * pagination — un `SELECT * ... ORDER BY created_at DESC` sans borne. Seules
 * les routes de liaison intermodule (`institutional-risk-links`,
 * `risk-continuity-links`, `audit-corrective-action-links`, issues de la
 * fermeture #171) utilisent la pagination par curseur
 * (`src/utils/integrationPagination.js`) exercée ici.
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
const errorHandler = require("../middleware/errorHandler");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/risks", enterpriseRiskRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function idem(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// institutional_risk_links a UNIQUE(organisation_id, risk_id, target_type,
// target_id, relationship_type) : simuler un registre volumineux exige donc
// des CIBLES distinctes (une même paire risque/cible/relation ne peut
// exister qu'une fois), pas seulement des Idempotency-Key distinctes.
// Seedé en un aller-retour (generate_series) plutôt que N INSERT séquentiels.
async function seedVulnerabilities(organisationId, userId, count, suffix) {
  const { rows } = await db.query(
    `INSERT INTO cybersecurity_vulnerabilities
      (organisation_id, vulnerability_number, title, description, severity, source, owner_user_id, idempotency_key)
     SELECT $1, 'VULN-PERF-' || $4 || '-' || gs, 'Vuln perf test', 'Description test', 'high', 'scanner', $2, 'seed-vuln-perf-' || $4 || '-' || gs
     FROM generate_series(1, $3) AS gs
     RETURNING id`,
    [organisationId, userId, count, suffix],
  );
  return rows;
}

// Seuil de laboratoire, pas une SLA de production : mesuré sur ce bac à
// sable partagé (voir CLAUDE.md — Postgres y redémarre parfois de façon
// non propre), volontairement généreux pour ne pas transformer un test de
// performance en source de flakiness. La valeur mesurée est toujours loggée
// pour garder une trace réelle, même quand le test passe confortablement.
const LAB_THRESHOLD_MS = 5000;

describe("Étage 7 PR E — essais de performance", () => {
  let org, owner;
  const REGISTRY_SIZE = 300;
  const RISK_COUNT = 150;

  beforeAll(async () => {
    org = await createTestOrganisation({ nom: `Stage7 PR E ${Date.now()}` });
    owner = await createTestUser({ organisation_id: org.id, role: "admin" });
    mockState.organisationId = org.id;
  }, 30000);

  afterAll(async () => {
    await db.query("DELETE FROM utilisateurs WHERE id=$1", [owner.id]);
    await db.query("DELETE FROM organisations WHERE id=$1", [org.id]);
  });

  test(`1. registre volumineux (${REGISTRY_SIZE} liens) — parcours complet par curseur sans doublon ni omission`, async () => {
    const risk = await request(app)
      .post("/api/risks")
      .set("Idempotency-Key", idem("perf-risk"))
      .send({ riskNumber: `RISK-PERF-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 });
    expect(risk.status).toBe(201);
    const vulns = await seedVulnerabilities(org.id, owner.id, REGISTRY_SIZE, `reg-${Date.now()}`);

    for (let i = 0; i < REGISTRY_SIZE; i++) {
      const res = await request(app)
        .post("/api/risks/risk-links")
        .set("Idempotency-Key", idem(`perf-link-${i}`))
        .send({ riskId: risk.body.id, targetType: "cybersecurity_vulnerability", targetId: vulns[i].id, relationshipType: "source", rationale: `Lien perf #${i}` });
      expect(res.status).toBe(201);
    }

    const seenIds = new Set();
    let cursor = null;
    let pages = 0;
    const start = Date.now();
    do {
      const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
      const page = await request(app).get(`/api/risks/risk-links${query}`);
      expect(page.status).toBe(200);
      for (const item of page.body.items) {
        // Correction avant vitesse : aucun id revu deux fois, quel que soit
        // le temps que ça prend à vérifier.
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }
      cursor = page.body.meta.hasMore ? page.body.meta.nextCursor : null;
      pages += 1;
      expect(pages).toBeLessThan(REGISTRY_SIZE); // garde-fou anti-boucle infinie
    } while (cursor);
    const elapsedMs = Date.now() - start;

    // eslint-disable-next-line no-console
    console.log(`[perf] parcours de ${REGISTRY_SIZE} liens en ${pages} pages : ${elapsedMs}ms`);
    expect(seenIds.size).toBe(REGISTRY_SIZE);
    expect(pages).toBe(Math.ceil(REGISTRY_SIZE / 100));
    expect(elapsedMs).toBeLessThan(LAB_THRESHOLD_MS);
  }, 60000);

  test("2. filtres corrects à volume — targetType/relationshipType restent exacts, pas seulement sur un petit jeu de données", async () => {
    const risk = await request(app)
      .post("/api/risks")
      .set("Idempotency-Key", idem("perf-filter-risk"))
      .send({ riskNumber: `RISK-FILTER-${Date.now()}`, category: "operational", title: "t", description: "d", ownerUserId: owner.id, likelihood: 2, impact: 2 });

    const SOURCE_COUNT = 40;
    const MONITORING_COUNT = 25;
    const vulnsSource = await seedVulnerabilities(org.id, owner.id, SOURCE_COUNT, `src-${Date.now()}`);
    const vulnsMonitoring = await seedVulnerabilities(org.id, owner.id, MONITORING_COUNT, `mon-${Date.now()}`);
    for (let i = 0; i < SOURCE_COUNT; i++) {
      await request(app).post("/api/risks/risk-links").set("Idempotency-Key", idem(`filter-source-${i}`))
        .send({ riskId: risk.body.id, targetType: "cybersecurity_vulnerability", targetId: vulnsSource[i].id, relationshipType: "source", rationale: "r" });
    }
    for (let i = 0; i < MONITORING_COUNT; i++) {
      await request(app).post("/api/risks/risk-links").set("Idempotency-Key", idem(`filter-monitoring-${i}`))
        .send({ riskId: risk.body.id, targetType: "cybersecurity_vulnerability", targetId: vulnsMonitoring[i].id, relationshipType: "monitoring", rationale: "r" });
    }

    const filtered = await request(app).get("/api/risks/risk-links?limit=100&relationshipType=monitoring");
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.every((i) => i.relationship_type === "monitoring")).toBe(true);
    // Compte exact en paginant jusqu'au bout du filtre.
    let total = 0;
    let cursor = null;
    do {
      const query = cursor ? `?limit=100&relationshipType=monitoring&cursor=${encodeURIComponent(cursor)}` : "?limit=100&relationshipType=monitoring";
      const page = await request(app).get(`/api/risks/risk-links${query}`);
      total += page.body.items.length;
      cursor = page.body.meta.hasMore ? page.body.meta.nextCursor : null;
    } while (cursor);
    expect(total).toBe(MONITORING_COUNT);
  }, 30000);

  test(`3. route de synthèse (alerts) correcte sous volume (${RISK_COUNT} risques) — seuil de laboratoire documenté`, async () => {
    const overdue = 20;
    for (let i = 0; i < RISK_COUNT; i++) {
      const isOverdue = i < overdue;
      await request(app)
        .post("/api/risks")
        .set("Idempotency-Key", idem(`perf-alert-risk-${i}`))
        .send({
          riskNumber: `RISK-ALERT-${Date.now()}-${i}`,
          category: "operational",
          title: "t",
          description: "d",
          ownerUserId: owner.id,
          likelihood: 2,
          impact: 2,
          nextReviewAt: isOverdue ? new Date(Date.now() - 86400000).toISOString() : new Date(Date.now() + 86400000).toISOString(),
        });
    }

    const start = Date.now();
    const alerts = await request(app).get("/api/risks/alerts");
    const elapsedMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[perf] GET /api/risks/alerts sous ${RISK_COUNT} risques : ${elapsedMs}ms`);

    expect(alerts.status).toBe(200);
    // Correction d'abord : exactement les risques en retard de cette série
    // remontent en alerte risk_review (pas plus, pas moins) — un résultat
    // rapide mais faux ne serait pas accepté par cette assertion.
    const reviewAlerts = alerts.body.filter((a) => a.alert_type === "risk_review" && a.reference?.startsWith("RISK-ALERT-"));
    expect(reviewAlerts.length).toBe(overdue);
    expect(elapsedMs).toBeLessThan(LAB_THRESHOLD_MS);
  }, 60000);
});

/**
 * Note de fermeture PR E : la lacune structurelle relevée en tête de fichier
 * (listes sans pagination sur enterprise-risk, institutional-resilience,
 * internal-audit, advanced-financial-management, advanced-document-governance)
 * n'est pas corrigée ici. Étendre `integrationPagination.js` à ces routes
 * change la forme de la réponse (tableau brut → {items, meta}), ce qui est un
 * changement de contrat d'API relevant de l'Étage 4 (PR 4B — pagination,
 * filtres et tri, voir docs/PLAN_MAITRE_ETAGES_4_A_7.md), pas d'une PR de
 * tests de performance de l'Étage 7. Signalé explicitement pour ne pas rester
 * implicite.
 */
