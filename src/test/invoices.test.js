const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockAutoTable = jest.fn((doc, options) => {
  mockAutoTable.lastOptions = options;
  doc.lastAutoTable = { finalY: 80 };
});

jest.mock("jspdf-autotable", () => mockAutoTable);

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(overrides = {}) {
  return jwt.sign(
    {
      id: 999,
      email: "invoice-test@example.com",
      role: "admin",
      ...overrides,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function createInvoice(clientId, overrides = {}) {
  const result = await db.query(
    `
    INSERT INTO invoices
      (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes)
    VALUES
      ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', $5, $6, $7, $8)
    RETURNING *
    `,
    [
      overrides.organisation_id ?? null,
      clientId,
      overrides.invoice_number || `INV-TEST-${Date.now()}-${Math.random()}`,
      overrides.status || "draft",
      overrides.subtotal ?? 100,
      overrides.tax_total ?? 0,
      overrides.total ?? 100,
      overrides.notes || null,
    ],
  );

  return result.rows[0];
}

async function createInvoiceItem(invoiceId, overrides = {}) {
  const result = await db.query(
    `
    INSERT INTO invoice_items
      (organisation_id, invoice_id, time_entry_id, description, quantity, unit_rate, amount)
    VALUES
      ($1, $2, NULL, $3, $4, $5, $6)
    RETURNING *
    `,
    [
      overrides.organisation_id ?? null,
      invoiceId,
      overrides.description || "Invoice item",
      overrides.quantity ?? 1,
      overrides.unit_rate ?? 100,
      overrides.amount ?? 100,
    ],
  );

  return result.rows[0];
}

async function createBillableEntry({ projet, user, organisation, description = "Temps facturable", isBilled = false }) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, '2026-06-01T09:00:00Z', '2026-06-01T11:00:00Z', $3, 100, $4, $5)
    RETURNING *
    `,
    [projet.id, user.id, description, isBilled, organisation.id],
  );

  return result.rows[0];
}

async function createFixture() {
  const organisation = await createTestOrganisation({ nom: `Org Invoice ${Date.now()}` });
  const user = await createTestUser({
    role: "admin",
    password: "Password123!",
    organisation_id: organisation.id,
  });
  const client = await createTestClient({
    organisation_id: organisation.id,
    hourly_rate_defaut: 90,
  });
  const projet = await createTestProjet(client.id, {
    organisation_id: organisation.id,
    nom: `Projet Invoice ${Date.now()}`,
    taux_horaire: 125,
  });
  const token = makeToken({
    id: user.id,
    email: user.email,
    role: user.role,
    organisation_id: organisation.id,
  });

  return { organisation, user, client, projet, token };
}

describe("invoices.routes", () => {
  test("GET /api/invoices liste les factures de l'organisation", async () => {
    const fixture = await createFixture();
    const invoice = await createInvoice(fixture.client.id, {
      organisation_id: fixture.organisation.id,
      invoice_number: `INV-ORG-LIST-${Date.now()}`,
    });

    const res = await request(app).get("/api/invoices").set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((row) => row.id)).toContain(invoice.id);
  });

  test("GET /api/invoices masque les factures d'une autre organisation", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const invoiceA = await createInvoice(fixtureA.client.id, {
      organisation_id: fixtureA.organisation.id,
      invoice_number: `INV-A-${Date.now()}`,
    });
    const invoiceB = await createInvoice(fixtureB.client.id, {
      organisation_id: fixtureB.organisation.id,
      invoice_number: `INV-B-${Date.now()}`,
    });

    const res = await request(app).get("/api/invoices").set("Authorization", `Bearer ${fixtureA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((row) => row.id)).toContain(invoiceA.id);
    expect(res.body.map((row) => row.id)).not.toContain(invoiceB.id);
  });

  test("GET /api/invoices/unbilled-entries retourne seulement les entrées admissibles", async () => {
    const fixture = await createFixture();

    const entry = await createBillableEntry({
      ...fixture,
      description: "Analyse facture",
      isBilled: false,
    });

    await createBillableEntry({
      ...fixture,
      description: "Déjà facturé",
      isBilled: true,
    });

    const res = await request(app)
      .get(`/api/invoices/unbilled-entries?client_id=${fixture.client.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: entry.id,
      projet_id: fixture.projet.id,
      client_id: fixture.client.id,
      description: "Analyse facture",
    });
    expect(Number(res.body[0].hours)).toBeCloseTo(2, 2);
    expect(Number(res.body[0].hourly_rate_used)).toBeCloseTo(100, 2);
    expect(Number(res.body[0].amount)).toBeCloseTo(200, 2);
  });

  test("POST /api/invoices crée une facture avec des entrées valides", async () => {
    const fixture = await createFixture();
    const entry = await createBillableEntry({
      ...fixture,
      description: "Création facture",
      isBilled: false,
    });

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        client_id: fixture.client.id,
        time_entry_ids: [entry.id],
        tax_rate: 15,
        notes: "Facture test",
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("invoice_number");
    expect(Number(res.body.organisation_id)).toBe(fixture.organisation.id);
    expect(Number(res.body.subtotal)).toBeCloseTo(200, 2);
    expect(Number(res.body.tax_total)).toBeCloseTo(30, 2);
    expect(Number(res.body.total)).toBeCloseTo(230, 2);

    const updatedEntry = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entry.id]);
    expect(updatedEntry.rows[0].is_billed).toBe(true);
    expect(updatedEntry.rows[0].invoice_id).toBe(res.body.id);

    const audit = await db.query(
      `
      SELECT action, entity_type, entity_id, actor_user_id, organisation_id, details
      FROM business_audit_logs
      WHERE entity_type = 'invoice'
        AND entity_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [res.body.id],
    );

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: "invoice.created",
      entity_type: "invoice",
      entity_id: res.body.id,
      actor_user_id: fixture.user.id,
      organisation_id: fixture.organisation.id,
    });
    expect(audit.rows[0].details).toMatchObject({
      clientId: fixture.client.id,
      timeEntryCount: 1,
    });
  });

  test("POST /api/invoices ne facture pas deux fois la meme entree en concurrence", async () => {
    const fixture = await createFixture();
    const entry = await createBillableEntry({
      ...fixture,
      description: "Facturation concurrente",
      isBilled: false,
    });
    const payload = {
      client_id: fixture.client.id,
      time_entry_ids: [entry.id],
      tax_rate: 0,
    };

    const responses = await Promise.all([
      request(app).post("/api/invoices").set("Authorization", `Bearer ${fixture.token}`).send(payload),
      request(app).post("/api/invoices").set("Authorization", `Bearer ${fixture.token}`).send(payload),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([201, 400]);

    const invoices = await db.query(
      `SELECT id FROM invoices WHERE organisation_id = $1 AND client_id = $2 AND deleted_at IS NULL`,
      [fixture.organisation.id, fixture.client.id],
    );
    const items = await db.query(`SELECT invoice_id FROM invoice_items WHERE time_entry_id = $1`, [entry.id]);
    const billedEntry = await db.query(`SELECT is_billed, invoice_id FROM time_entries WHERE id = $1`, [entry.id]);

    expect(invoices.rows).toHaveLength(1);
    expect(items.rows).toHaveLength(1);
    expect(billedEntry.rows[0].is_billed).toBe(true);
    expect(billedEntry.rows[0].invoice_id).toBe(invoices.rows[0].id);
  });

  test("POST /api/invoices retourne l'erreur service sans crash handler", async () => {
    const fixture = await createFixture();

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        client_id: fixture.client.id,
        time_entry_ids: [2147483647],
        tax_rate: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("message");
    expect(res.body.message).not.toMatch(/res\.status|next is not a function/i);
  });

  test("POST /api/invoices refuse si le payload contient une entrée hors organisation", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const validEntry = await createBillableEntry({
      ...fixtureA,
      description: "Entrée valide",
      isBilled: false,
    });
    const foreignEntry = await createBillableEntry({
      ...fixtureB,
      description: "Entrée autre org",
      isBilled: false,
    });

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixtureA.token}`)
      .send({
        client_id: fixtureA.client.id,
        time_entry_ids: [validEntry.id, foreignEntry.id],
        tax_rate: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty(
      "message",
      "Certaines entrées de temps sont invalides, déjà facturées ou hors organisation.",
    );

    const foreignAfter = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [foreignEntry.id]);
    expect(foreignAfter.rows[0].is_billed).toBe(false);
    expect(foreignAfter.rows[0].invoice_id).toBeNull();
  });

  test("GET /api/invoices/:id ne retourne pas les items d'une autre organisation", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const invoice = await createInvoice(fixtureA.client.id, {
      organisation_id: fixtureA.organisation.id,
      invoice_number: `INV-DETAIL-ORG-${Date.now()}`,
    });

    await createInvoiceItem(invoice.id, {
      organisation_id: fixtureA.organisation.id,
      description: "Visible detail item",
      amount: 100,
    });
    await createInvoiceItem(invoice.id, {
      organisation_id: fixtureB.organisation.id,
      description: "Leaked detail item",
      amount: 200,
    });

    const res = await request(app).get(`/api/invoices/${invoice.id}`).set("Authorization", `Bearer ${fixtureA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.description)).toContain("Visible detail item");
    expect(res.body.items.map((item) => item.description)).not.toContain("Leaked detail item");
  });

  test("GET /api/invoices/:id refuse un id invalide", async () => {
    const fixture = await createFixture();

    const res = await request(app).get("/api/invoices/abc").set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("message", "ID invalide");
  });
  test("GET /api/invoices/:id/pdf ne rend pas les items d'une autre organisation", async () => {
    mockAutoTable.mockClear();
    mockAutoTable.lastOptions = null;

    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const invoice = await createInvoice(fixtureA.client.id, {
      organisation_id: fixtureA.organisation.id,
      invoice_number: `INV-PDF-ORG-${Date.now()}`,
    });

    await createInvoiceItem(invoice.id, {
      organisation_id: fixtureA.organisation.id,
      description: "Visible item",
      amount: 100,
    });
    await createInvoiceItem(invoice.id, {
      organisation_id: fixtureB.organisation.id,
      description: "Leaked item",
      amount: 200,
    });

    const res = await request(app).get(`/api/invoices/${invoice.id}/pdf`).set("Authorization", `Bearer ${fixtureA.token}`);

    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toContain("application/pdf");
    expect(mockAutoTable).toHaveBeenCalled();

    const renderedDescriptions = mockAutoTable.lastOptions.body.map((row) => row[0]);
    expect(renderedDescriptions).toContain("Visible item");
    expect(renderedDescriptions).not.toContain("Leaked item");
  });

  test("PATCH /api/invoices/:id modifie une facture de la même organisation", async () => {
    const fixture = await createFixture();
    const invoice = await createInvoice(fixture.client.id, {
      organisation_id: fixture.organisation.id,
      status: "draft",
      invoice_number: `INV-ORG-PATCH-${Date.now()}`,
    });

    const res = await request(app)
      .patch(`/api/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ status: "paid", notes: "patched org" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.notes).toBe("patched org");
    expect(Number(res.body.organisation_id)).toBe(fixture.organisation.id);
  });

  test("PATCH /api/invoices/:id refuse une facture d'une autre organisation", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const invoiceB = await createInvoice(fixtureB.client.id, {
      organisation_id: fixtureB.organisation.id,
      invoice_number: `INV-CROSS-PATCH-${Date.now()}`,
    });

    const res = await request(app)
      .patch(`/api/invoices/${invoiceB.id}`)
      .set("Authorization", `Bearer ${fixtureA.token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(404);
  });

  test("DELETE /api/invoices/:id supprime une facture de la même organisation", async () => {
    const fixture = await createFixture();
    const invoice = await createInvoice(fixture.client.id, {
      organisation_id: fixture.organisation.id,
      invoice_number: `INV-ORG-DELETE-${Date.now()}`,
    });

    const res = await request(app).delete(`/api/invoices/${invoice.id}`).set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, released_entries: 0 });

    const deleted = await db.query(`SELECT deleted_at FROM invoices WHERE id = $1`, [invoice.id]);
    if (deleted.rows[0]) {
      expect(deleted.rows[0].deleted_at).toBeTruthy();
    }
  });

  test("DELETE /api/invoices/:id libere les entrees de temps facturees", async () => {
    const fixture = await createFixture();
    const entry = await createBillableEntry({
      ...fixture,
      description: "A refacturer apres suppression",
      isBilled: false,
    });

    const created = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        client_id: fixture.client.id,
        time_entry_ids: [entry.id],
        tax_rate: 0,
      });

    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete(`/api/invoices/${created.body.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ success: true, released_entries: 1 });

    const releasedEntry = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entry.id]);
    expect(releasedEntry.rows[0].is_billed).toBe(false);
    expect(releasedEntry.rows[0].invoice_id).toBeNull();

    const retainedItems = await db.query("SELECT invoice_id FROM invoice_items WHERE invoice_id = $1", [created.body.id]);
    expect(retainedItems.rows).toHaveLength(1);
  });

  test("soft delete client et projet preserve la facture existante", async () => {
    const fixture = await createFixture();
    const entry = await createBillableEntry({
      ...fixture,
      description: "Historique facture",
      isBilled: false,
    });
    const created = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        client_id: fixture.client.id,
        time_entry_ids: [entry.id],
        tax_rate: 0,
      });

    expect(created.status).toBe(201);

    const deletedProject = await request(app)
      .delete(`/api/projets/${fixture.projet.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);
    const deletedClient = await request(app)
      .delete(`/api/clients/${fixture.client.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(deletedProject.status).toBe(200);
    expect(deletedClient.status).toBe(200);

    const invoice = await request(app)
      .get(`/api/invoices/${created.body.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);
    const billedEntry = await db.query(`SELECT is_billed, invoice_id FROM time_entries WHERE id = $1`, [entry.id]);

    expect(invoice.status).toBe(200);
    expect(invoice.body.items).toHaveLength(1);
    expect(billedEntry.rows[0].is_billed).toBe(true);
    expect(billedEntry.rows[0].invoice_id).toBe(created.body.id);
  });

  test("PATCH /api/invoices marque les entrées facturées à l'envoi puis les libère à l'annulation", async () => {
    const fixture = await createFixture();
    const entry = await createBillableEntry({
      ...fixture,
      description: "Cycle de vie facture",
      isBilled: false,
    });
    const created = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        client_id: fixture.client.id,
        time_entry_ids: [entry.id],
        tax_rate: 0,
      });

    const sent = await request(app)
      .patch(`/api/invoices/${created.body.id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ status: "sent" });
    const afterSent = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entry.id]);

    expect(sent.status).toBe(200);
    expect(afterSent.rows[0]).toMatchObject({ is_billed: true, invoice_id: created.body.id });

    const voided = await request(app)
      .patch(`/api/invoices/${created.body.id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ status: "void" });
    const afterVoid = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entry.id]);

    expect(voided.status).toBe(200);
    expect(afterVoid.rows[0]).toMatchObject({ is_billed: false, invoice_id: null });
  });

  test("DELETE /api/invoices/:id refuse une facture déjà émise", async () => {
    const fixture = await createFixture();
    const invoice = await createInvoice(fixture.client.id, {
      organisation_id: fixture.organisation.id,
      status: "sent",
      invoice_number: `INV-ISSUED-DELETE-${Date.now()}`,
    });

    const res = await request(app).delete(`/api/invoices/${invoice.id}`).set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Annulez plutôt/);
  });
});
