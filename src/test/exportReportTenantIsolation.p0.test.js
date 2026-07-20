const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../app");
const db = require("../../db");
const {
  createTestOrganisation,
  createTestUser,
  createTestClient,
  createTestProjet,
} = require("./helpers/testData");

function makeToken(user, organisation) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: "admin",
      organisation_id: organisation.id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" },
  );
}

async function createInvoice({ organisation, client, marker }) {
  const result = await db.query(
    `
      INSERT INTO invoices (
        organisation_id,
        client_id,
        invoice_number,
        status,
        issue_date,
        due_date,
        subtotal,
        tax_total,
        total,
        notes
      )
      VALUES ($1, $2, $3, 'draft', '2026-07-20', '2026-08-04', 100, 14.98, 114.98, $4)
      RETURNING *
    `,
    [organisation.id, client.id, `INV-${marker}`, marker],
  );
  return result.rows[0];
}

async function createTimeEntry({ organisation, user, projet, marker }) {
  const result = await db.query(
    `
      INSERT INTO time_entries (
        projet_id,
        utilisateur_id,
        start_time,
        end_time,
        description,
        hourly_rate_used,
        is_billed,
        organisation_id
      )
      VALUES ($1, $2, '2026-07-20T09:00:00Z', '2026-07-20T10:00:00Z', $3, 100, false, $4)
      RETURNING *
    `,
    [projet.id, user.id, marker, organisation.id],
  );
  return result.rows[0];
}

async function createFixture(label) {
  const marker = `P0-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organisation = await createTestOrganisation({ nom: `Organisation ${marker}` });
  await db.query("UPDATE organisations SET plan_type = 'pro' WHERE id = $1", [organisation.id]);

  const user = await createTestUser({
    nom: `Admin ${marker}`,
    role: "admin",
    organisation_id: organisation.id,
  });
  const client = await createTestClient({
    nom: `Client ${marker}`,
    organisation_id: organisation.id,
  });
  const projet = await createTestProjet(client.id, {
    nom: `Projet ${marker}`,
    organisation_id: organisation.id,
  });
  const invoice = await createInvoice({ organisation, client, marker });
  const timeEntry = await createTimeEntry({ organisation, user, projet, marker });
  const token = makeToken(user, organisation);

  return { marker, organisation, user, client, projet, invoice, timeEntry, token };
}

async function cleanup(fixtures) {
  const orgIds = fixtures.map((fixture) => fixture.organisation.id);
  const userIds = fixtures.map((fixture) => fixture.user.id);

  await db.query("DELETE FROM business_audit_logs WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM time_entries WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM invoices WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM projets WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM clients WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM utilisateurs WHERE id = ANY($1)", [userIds]);
  await db.query("DELETE FROM organisations WHERE id = ANY($1)", [orgIds]);
}

describe("P0 — isolation multi-tenant des exports et rapports", () => {
  let fixtureA;
  let fixtureB;

  beforeAll(async () => {
    fixtureA = await createFixture("A");
    fixtureB = await createFixture("B");
  });

  afterAll(async () => {
    await cleanup([fixtureA, fixtureB]);
  });

  test("l’export CSV de A contient uniquement les factures et clients de A", async () => {
    const response = await request(app)
      .get("/api/integrations/export/invoices?startDate=2026-07-01&endDate=2026-07-31")
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain(`invoices_${fixtureA.organisation.id}_`);

    expect(response.text).toContain(`INV-${fixtureA.marker}`);
    expect(response.text).toContain(`Client ${fixtureA.marker}`);
    expect(response.text).toContain(fixtureA.marker);

    expect(response.text).not.toContain(`INV-${fixtureB.marker}`);
    expect(response.text).not.toContain(`Client ${fixtureB.marker}`);
    expect(response.text).not.toContain(fixtureB.marker);
  });

  test("les paramètres de requête ne peuvent pas forcer l’organisation B dans l’export de A", async () => {
    const response = await request(app)
      .get(`/api/integrations/export/invoices?organisation_id=${fixtureB.organisation.id}&startDate=2026-07-01&endDate=2026-07-31`)
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain(`INV-${fixtureA.marker}`);
    expect(response.text).not.toContain(`INV-${fixtureB.marker}`);
    expect(response.headers["content-disposition"]).toContain(`invoices_${fixtureA.organisation.id}_`);
  });

  test("le rapport de A contient son activité et aucune donnée de B", async () => {
    const response = await request(app)
      .get("/api/reports?date_debut=2026-07-01&date_fin=2026-07-31")
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(response.status).toBe(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain(fixtureA.marker);
    expect(serialized).toContain(`Projet ${fixtureA.marker}`);
    expect(serialized).not.toContain(fixtureB.marker);
    expect(serialized).not.toContain(`Projet ${fixtureB.marker}`);
  });

  test("un paramètre organisation_id hostile ne change jamais la portée du rapport", async () => {
    const response = await request(app)
      .get(`/api/reports?date_debut=2026-07-01&date_fin=2026-07-31&organisation_id=${fixtureB.organisation.id}`)
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(response.status).toBe(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain(fixtureA.marker);
    expect(serialized).not.toContain(fixtureB.marker);
  });
});
