const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(user, organisation) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organisation_id: organisation.id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function createEntry({ projet, user, organisation, description }) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, '2026-06-02T09:00:00Z', '2026-06-02T10:00:00Z', $3, 100, false, $4)
    RETURNING *
    `,
    [projet.id, user.id, description, organisation.id],
  );

  return result.rows[0];
}

async function createInvoice({ client, organisation }) {
  const result = await db.query(
    `
    INSERT INTO invoices
      (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total)
    VALUES
      ($1, $2, $3, 'draft', CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 100, 0, 100)
    RETURNING *
    `,
    [organisation.id, client.id, `INV-GLOBAL-${organisation.id}-${Date.now()}`],
  );

  return result.rows[0];
}

async function createActivity({ user, organisation, title }) {
  const result = await db.query(
    `
    INSERT INTO activity_logs
      (utilisateur_id, organisation_id, app_name, window_title, duration_seconds, type, captured_at)
    VALUES
      ($1, $2, 'Code', $3, 60, 'active', NOW())
    RETURNING *
    `,
    [user.id, organisation.id, title],
  );

  return result.rows[0];
}

describe("multi-org global isolation", () => {
  test("admin org A ne lit ni modifie les donnees metier de org B", async () => {
    const orgA = await createTestOrganisation({ nom: `Org Global A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Org Global B ${Date.now()}` });
    const userA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const userB = await createTestUser({ role: "admin", organisation_id: orgB.id });
    const clientA = await createTestClient({ nom: `Client Global A ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Client Global B ${Date.now()}`, organisation_id: orgB.id });
    const projetA = await createTestProjet(clientA.id, { nom: `Projet Global A ${Date.now()}`, organisation_id: orgA.id });
    const projetB = await createTestProjet(clientB.id, { nom: `Projet Global B ${Date.now()}`, organisation_id: orgB.id });
    const entryA = await createEntry({ projet: projetA, user: userA, organisation: orgA, description: "Entry A" });
    const entryB = await createEntry({ projet: projetB, user: userB, organisation: orgB, description: "Entry B" });
    const invoiceA = await createInvoice({ client: clientA, organisation: orgA });
    const invoiceB = await createInvoice({ client: clientB, organisation: orgB });
    const activityA = await createActivity({ user: userA, organisation: orgA, title: "Activity A" });
    const activityB = await createActivity({ user: userB, organisation: orgB, title: "Activity B" });
    const tokenA = makeToken(userA, orgA);

    const clients = await request(app).get("/api/clients").set("Authorization", `Bearer ${tokenA}`);
    expect(clients.body.map((row) => row.id)).toContain(clientA.id);
    expect(clients.body.map((row) => row.id)).not.toContain(clientB.id);

    const projets = await request(app).get("/api/projets").set("Authorization", `Bearer ${tokenA}`);
    expect(projets.body.map((row) => row.id)).toContain(projetA.id);
    expect(projets.body.map((row) => row.id)).not.toContain(projetB.id);

    const entries = await request(app).get("/api/timesheet/entries").set("Authorization", `Bearer ${tokenA}`);
    expect(entries.body.data.map((row) => row.id)).toContain(entryA.id);
    expect(entries.body.data.map((row) => row.id)).not.toContain(entryB.id);

    const invoices = await request(app).get("/api/invoices").set("Authorization", `Bearer ${tokenA}`);
    expect(invoices.body.map((row) => row.id)).toContain(invoiceA.id);
    expect(invoices.body.map((row) => row.id)).not.toContain(invoiceB.id);

    const activities = await request(app).get("/api/activity/recent").set("Authorization", `Bearer ${tokenA}`);
    expect(activities.body.map((row) => row.id)).toContain(activityA.id);
    expect(activities.body.map((row) => row.id)).not.toContain(activityB.id);

    const updateClientB = await request(app)
      .put(`/api/clients/${clientB.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ nom: "Client B modifie par A" });
    expect(updateClientB.status).toBe(404);

    const updateEntryB = await request(app)
      .put(`/api/timesheet/entries/${entryB.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ description: "Entry B modifiee par A" });
    expect(updateEntryB.status).toBe(404);

    const updateInvoiceB = await request(app)
      .patch(`/api/invoices/${invoiceB.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ status: "paid" });
    expect(updateInvoiceB.status).toBe(404);
  });
});
