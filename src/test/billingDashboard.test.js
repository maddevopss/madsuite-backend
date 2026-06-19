const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organisation_id: user.organisation_id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("billingDashboard.routes", () => {
  let organisation;
  let otherOrganisation;
  let user;
  let client;
  let otherClient;
  let projet;
  let otherProjet;
  let invoiceNumbers = [];

  beforeAll(async () => {
    organisation = await createTestOrganisation({
      nom: `Billing Dashboard Org ${Date.now()}`,
    });

    otherOrganisation = await createTestOrganisation({
      nom: `Billing Dashboard Other Org ${Date.now()}`,
    });

    user = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });

    const otherUser = await createTestUser({
      role: "admin",
      organisation_id: otherOrganisation.id,
    });

    client = await createTestClient({
      nom: `Billing Dashboard Client ${Date.now()}`,
      hourly_rate_defaut: 110,
      organisation_id: organisation.id,
    });

    otherClient = await createTestClient({
      nom: `Billing Dashboard Other Client ${Date.now()}`,
      hourly_rate_defaut: 110,
      organisation_id: otherOrganisation.id,
    });

    projet = await createTestProjet(client.id, {
      nom: `Billing Dashboard Projet ${Date.now()}`,
      taux_horaire: 125,
      organisation_id: organisation.id,
    });

    otherProjet = await createTestProjet(otherClient.id, {
      nom: `Billing Dashboard Other Projet ${Date.now()}`,
      taux_horaire: 125,
      organisation_id: otherOrganisation.id,
    });

    const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
    invoiceNumbers = [`BD-${suffix}-001`, `BD-${suffix}-002`, `BD-${suffix}-003`, `BD-${suffix}-OTHER`];

    await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '2 hours', 'Unbilled dashboard work', 150, FALSE, $3),
        ($1, $2, NOW() - INTERVAL '8 hours', NOW() - INTERVAL '5 hours', 'Billed dashboard work', 120, TRUE, $3)
      `,
      [projet.id, user.id, organisation.id],
    );

    await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, NOW() - INTERVAL '6 hours', NOW() - INTERVAL '1 hours', 'Other org unbilled work', 999, FALSE, $3)
      `,
      [otherProjet.id, otherUser.id, otherOrganisation.id],
    );

    await db.query(
      `
      INSERT INTO invoices
        (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, billed_by, created_at)
      VALUES
        ($1, $2, $4, 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days', 200, 0, 200, $3, NOW()),
        ($1, $2, $5, 'paid', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days', 75, 0, 75, $3, NOW()),
        ($1, $2, $6, 'sent', CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '7 days', 90, 0, 90, $3, NOW())
      `,
      [organisation.id, client.id, user.id, invoiceNumbers[0], invoiceNumbers[1], invoiceNumbers[2]],
    );

    await db.query(
      `
      INSERT INTO invoices
        (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, billed_by, created_at)
      VALUES
        ($1, $2, $4, 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days', 999, 0, 999, $3, NOW())
      `,
      [otherOrganisation.id, otherClient.id, otherUser.id, invoiceNumbers[3]],
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM invoice_items WHERE organisation_id = ANY($1::int[])`, [
      [organisation.id, otherOrganisation.id],
    ]);
    await db.query(`DELETE FROM invoices WHERE organisation_id = ANY($1::int[])`, [[organisation.id, otherOrganisation.id]]);
    await db.query(`DELETE FROM time_entries WHERE organisation_id = ANY($1::int[])`, [
      [organisation.id, otherOrganisation.id],
    ]);
    await db.query(`DELETE FROM projets WHERE organisation_id = ANY($1::int[])`, [[organisation.id, otherOrganisation.id]]);
    await db.query(`DELETE FROM clients WHERE organisation_id = ANY($1::int[])`, [[organisation.id, otherOrganisation.id]]);
    await db.query(
      `
      DELETE FROM user_sessions
      WHERE utilisateur_id IN (
        SELECT id
        FROM utilisateurs
        WHERE organisation_id = ANY($1::int[])
      )
    `,
      [[organisation.id, otherOrganisation.id]],
    );
    await db.pool
      .query(
        `DELETE FROM refresh_tokens WHERE utilisateur_id IN (
      SELECT id
      FROM utilisateurs
      WHERE organisation_id = ANY($1::int[])
    )`,
        [[organisation.id, otherOrganisation.id]],
      )
      .catch(() => null);
    await db.query(`DELETE FROM utilisateurs WHERE organisation_id = ANY($1::int[])`, [
      [organisation.id, otherOrganisation.id],
    ]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[organisation.id, otherOrganisation.id]]);
  });

  test("GET /api/billing/dashboard refuse sans token", async () => {
    const res = await request(app).get("/api/billing/dashboard");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/billing/dashboard retourne les indicateurs de facturation scopés par organisation", async () => {
    const token = makeToken(user);

    const res = await request(app).get("/api/billing/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);

    expect(res.body.total_to_invoice).toBeGreaterThanOrEqual(300);
    expect(res.body.total_to_invoice).toBeLessThan(999);

    expect(res.body.unbilled_hours).toBeGreaterThanOrEqual(2);
    expect(res.body.billed_hours).toBeGreaterThanOrEqual(3);

    expect(res.body.total_invoiced_this_month).toBeGreaterThanOrEqual(365);
    expect(res.body.total_invoiced_this_month).toBeLessThan(1000);

    expect(res.body.total_paid_this_month).toBeGreaterThanOrEqual(75);

    expect(res.body.top_clients_to_bill[0]).toMatchObject({
      client_id: client.id,
      client_nom: client.nom,
    });

    expect(res.body.top_projects_to_bill[0]).toMatchObject({
      projet_id: projet.id,
      projet_nom: projet.nom,
      client_nom: client.nom,
    });

    const recentNumbers = res.body.recent_invoices.map((invoice) => invoice.invoice_number);
    const overdueNumbers = res.body.overdue_invoices.map((invoice) => invoice.invoice_number);

    expect(recentNumbers).toContain(invoiceNumbers[0]);
    expect(recentNumbers).toContain(invoiceNumbers[1]);
    expect(recentNumbers).not.toContain(invoiceNumbers[3]);

    expect(overdueNumbers).toContain(invoiceNumbers[2]);
    expect(overdueNumbers).not.toContain(invoiceNumbers[3]);
  });
});
