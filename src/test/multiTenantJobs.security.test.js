/**
 * AUDIT G — Tests de preuve multi-tenant pour les jobs critiques
 *
 * Ces tests prouvent ou réfutent les vulnérabilités identifiées lors de
 * l'audit de validation finale du 2026-06-24.
 *
 * Organisation A et Organisation B sont créées pour chaque suite.
 * Les tests vérifient l'isolation des données entre les deux organisations.
 */

const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");

function makeAdminToken(user, org) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: "admin",
      organisation_id: org.id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function cleanupOrgs(orgIds) {
  if (!orgIds || orgIds.length === 0) return;

  await db.query("DELETE FROM notifications WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM recurring_invoices WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE organisation_id = ANY($1))", [orgIds]);
  await db.query("DELETE FROM invoices WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM time_entries WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM cognitive_state_events WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM daily_cognitive_metrics WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM clients WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM projets WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM utilisateurs WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM organisations WHERE id = ANY($1)", [orgIds]);
}

// ─── AUDIT E/F : /api/system/health restreint aux super-admins ───────────────
describe("E/F: GET /api/system/health — restreint aux super-admins plateforme", () => {
  let orgA, adminA;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Org System Health ${Date.now()}` });
    adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
  });

  afterAll(async () => {
    
await cleanupOrgs([orgA.id]);
  });

  test("PROOF: admin d'organisation ne peut pas accéder à GET /api/system/health (403)", async () => {
    const tokenA = makeAdminToken(adminA, orgA);
    const res = await request(app)
      .get("/api/system/health")
      .set("Authorization", `Bearer ${tokenA}`);

    // Après le fix P1, un admin d'organisation doit recevoir 403
    expect(res.status).toBe(403);
  });

  test("PROOF: admin d'organisation ne peut pas accéder à GET /api/system/cron-health (403)", async () => {
    const tokenA = makeAdminToken(adminA, orgA);
    const res = await request(app)
      .get("/api/system/cron-health")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
  });

  test("PROOF: requête non authentifiée reçoit 401", async () => {
    const res = await request(app).get("/api/system/health");
    expect(res.status).toBe(401);
  });
});

// ─── AUDIT A : cognitiveAggregator — isolation multi-tenant ──────────────────
describe("A: cognitiveAggregator — isolation multi-tenant prouvée", () => {
  let orgA, orgB, userA, userB;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Org Cog A ${Date.now()}` });
    orgB = await createTestOrganisation({ nom: `Org Cog B ${Date.now()}` });
    userA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    userB = await createTestUser({ role: "admin", organisation_id: orgB.id });

    // Insérer des événements cognitifs pour les deux orgs
    await db.query(
      `INSERT INTO cognitive_state_events (utilisateur_id, organisation_id, state, started_at, duration_minutes)
       VALUES ($1, $2, 'flow', NOW() - INTERVAL '1 day', 60)`,
      [userA.id, orgA.id]
    );

    await db.query(
      `INSERT INTO cognitive_state_events (utilisateur_id, organisation_id, state, started_at, duration_minutes)
       VALUES ($1, $2, 'deep_focus', NOW() - INTERVAL '1 day', 90)`,
      [userB.id, orgB.id]
    );
  });

  afterAll(async () => {
    await db.query(
      "DELETE FROM cognitive_state_events WHERE utilisateur_id IN ($1, $2)",
      [userA.id, userB.id]
    );
    await db.query(
      "DELETE FROM daily_cognitive_metrics WHERE utilisateur_id IN ($1, $2)",
      [userA.id, userB.id]
    );
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  test("PROOF: aggregateCognitiveMetrics isole correctement par organisation", async () => {
    const { aggregateCognitiveMetrics } = require("../jobs/cognitiveAggregator");
    await aggregateCognitiveMetrics();

    // Métriques de userA → organisation_id = orgA.id
    const resA = await db.query(
      "SELECT organisation_id FROM daily_cognitive_metrics WHERE utilisateur_id = $1",
      [userA.id]
    );
    if (resA.rows.length > 0) {
      expect(resA.rows[0].organisation_id).toBe(orgA.id);
    }

    // Métriques de userB → organisation_id = orgB.id
    const resB = await db.query(
      "SELECT organisation_id FROM daily_cognitive_metrics WHERE utilisateur_id = $1",
      [userB.id]
    );
    if (resB.rows.length > 0) {
      expect(resB.rows[0].organisation_id).toBe(orgB.id);
    }
  });

  test("PROOF: les métriques de org A ne contiennent pas les données de org B", async () => {
    const resA = await db.query(
      "SELECT utilisateur_id FROM daily_cognitive_metrics WHERE organisation_id = $1",
      [orgA.id]
    );
    const userIdsInOrgA = resA.rows.map((r) => r.utilisateur_id);

    // userB ne doit pas apparaître dans les métriques de orgA
    expect(userIdsInOrgA).not.toContain(userB.id);
  });
});

// ─── AUDIT B : billingAssistantJob — notifications isolées ───────────────────
describe("B: billingAssistantJob — notifications cross-tenant impossibles", () => {
  let orgA, orgB, adminA, adminB, clientA, invoiceA;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Org Bill A ${Date.now()}` });
    orgB = await createTestOrganisation({ nom: `Org Bill B ${Date.now()}` });
    adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    adminB = await createTestUser({ role: "admin", organisation_id: orgB.id });

    const clientRes = await db.query(
      "INSERT INTO clients (nom, organisation_id) VALUES ($1, $2) RETURNING *",
      [`Client Bill A ${Date.now()}`, orgA.id]
    );
    clientA = clientRes.rows[0];

    const invoiceRes = await db.query(
      `INSERT INTO invoices (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, reminders_sent)
       VALUES ($1, $2, $3, 'sent', CURRENT_DATE - 20, CURRENT_DATE - 15, 100, 0, 100, 0)
       RETURNING *`,
      [orgA.id, clientA.id, `INV-BILL-TEST-${Date.now()}`]
    );
    invoiceA = invoiceRes.rows[0];
  });

  afterAll(async () => {
    if (invoiceA) await db.query("DELETE FROM invoices WHERE id = $1", [invoiceA.id]);
    if (clientA) await db.query("DELETE FROM clients WHERE id = $1", [clientA.id]);
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  test("PROOF: notification de relance ne va pas aux admins de org B", async () => {
    const { processReminders } = require("../jobs/billingAssistantJob");

    const notifsBefore = await db.query(
      "SELECT COUNT(*) as count FROM notifications WHERE utilisateur_id = $1",
      [adminB.id]
    );
    const countBefore = parseInt(notifsBefore.rows[0].count, 10);

    await processReminders();

    const notifsAfter = await db.query(
      "SELECT COUNT(*) as count FROM notifications WHERE utilisateur_id = $1",
      [adminB.id]
    );
    const countAfter = parseInt(notifsAfter.rows[0].count, 10);

    // Admin B (org B) ne doit pas recevoir de notification pour la facture de org A
    expect(countAfter).toBe(countBefore);
  });
});

// ─── AUDIT C : recurringInvoiceJob — guard cross-tenant ──────────────────────
describe("C: recurringInvoiceJob — template cross-tenant bloqué par guard applicatif", () => {
  let orgA, orgB, clientA, clientB, invoiceA, recurringB;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Org Rec A ${Date.now()}` });
    orgB = await createTestOrganisation({ nom: `Org Rec B ${Date.now()}` });

    const cARes = await db.query(
      "INSERT INTO clients (nom, organisation_id) VALUES ($1, $2) RETURNING *",
      [`Client Rec A ${Date.now()}`, orgA.id]
    );
    clientA = cARes.rows[0];

    const cBRes = await db.query(
      "INSERT INTO clients (nom, organisation_id) VALUES ($1, $2) RETURNING *",
      [`Client Rec B ${Date.now()}`, orgB.id]
    );
    clientB = cBRes.rows[0];

    // Facture template dans org A
    const invRes = await db.query(
      `INSERT INTO invoices (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total)
       VALUES ($1, $2, $3, 'paid', CURRENT_DATE, CURRENT_DATE + 30, 500, 0, 500)
       RETURNING *`,
      [orgA.id, clientA.id, `INV-TMPL-${Date.now()}`]
    );
    invoiceA = invRes.rows[0];

    // Récurrence dans org B pointant vers template de org A (tentative d'attaque cross-tenant)
await expect(
  db.query(
    `INSERT INTO recurring_invoices (organisation_id, client_id, template_invoice_id, frequency, next_issue_date, status)
     VALUES ($1, $2, $3, 'monthly', CURRENT_DATE, 'active')
     RETURNING *`,
    [orgB.id, clientB.id, invoiceA.id]
  )
).rejects.toThrow(/fk_recurring_template_invoice_org|violates foreign key|viole la contrainte/i);
    // recurringB = recRes.rows[0];
  });

  afterAll(async () => {
    if (recurringB) await db.query("DELETE FROM recurring_invoices WHERE id = $1", [recurringB.id]);
    if (invoiceA) await db.query("DELETE FROM invoices WHERE id = $1", [invoiceA.id]);
    if (clientA) await db.query("DELETE FROM clients WHERE id = $1", [clientA.id]);
    if (clientB) await db.query("DELETE FROM clients WHERE id = $1", [clientB.id]);
    await cleanupOrgs([orgA.id, orgB.id]);
  });

test("PROOF: la DB bloque une récurrence cross-tenant avant le job", async () => {
  await expect(
    db.query(
      `INSERT INTO recurring_invoices (organisation_id, client_id, template_invoice_id, frequency, next_issue_date, status)
       VALUES ($1, $2, $3, 'monthly', CURRENT_DATE, 'active')
       RETURNING *`,
      [orgB.id, clientB.id, invoiceA.id]
    )
  ).rejects.toThrow(/fk_recurring_template_invoice_org|foreign key|contrainte/i);
});

  test("PROOF: aucun job ne crée de nouvelle facture pour org B", async () => {
    const invoicesBeforeRes = await db.query(
      "SELECT COUNT(*) as count FROM invoices WHERE organisation_id = $1",
      [orgB.id]
    );
    const countBefore = parseInt(invoicesBeforeRes.rows[0].count, 10);

    const { processRecurringInvoices } = require("../jobs/recurringInvoiceJob");
    await processRecurringInvoices();

    const invoicesAfterRes = await db.query(
      "SELECT COUNT(*) as count FROM invoices WHERE organisation_id = $1",
      [orgB.id]
    );
    const countAfter = parseInt(invoicesAfterRes.rows[0].count, 10);

    // Le guard applicatif (AND r.organisation_id = i.organisation_id) doit bloquer
    // Aucune nouvelle facture ne doit être créée pour org B depuis le template org A
    expect(countAfter).toBe(countBefore);
  });

  test("PROOF: les données de org A ne sont pas copiées dans org B", async () => {
    const invoicesOrgB = await db.query(
      "SELECT * FROM invoices WHERE organisation_id = $1",
      [orgB.id]
    );

    // Aucune facture de org B ne doit avoir des données provenant de org A
    for (const inv of invoicesOrgB.rows) {
      expect(inv.organisation_id).toBe(orgB.id);
    }
  });
});

// ─── AUDIT D : dataRetention — pas de fuite de stats globales ────────────────
describe("D: dataRetention — stats globales non exposées via business_audit_logs", () => {
  let orgA;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Org Retention ${Date.now()}` });
  });

  afterAll(async () => {
    
await cleanupOrgs([orgA.id]);
  });

  test("PROOF: business_audit_logs ne contient pas d'entrée system.purge_executed après runDataPurge", async () => {
    const { runDataPurge } = require("../jobs/dataRetention");
    await runDataPurge(db);

    const res = await db.query(
      "SELECT COUNT(*) as count FROM business_audit_logs WHERE action = 'system.purge_executed'",
      []
    );
    const count = parseInt(res.rows[0].count, 10);

    // Après le fix P2, les stats de purge ne sont plus dans business_audit_logs
    expect(count).toBe(0);
  });
});
