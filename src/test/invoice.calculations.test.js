const request = require("supertest");
const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");
const jwt = require("jsonwebtoken");

function makeToken(overrides = {}) {
  return jwt.sign(
    {
      id: 999,
      email: "calc-test@example.com",
      role: "admin",
      ...overrides,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function createBillableEntry({ projet, user, organisation, durationHours, rate, description = "Test", isBilled = false }) {
  // duration in hours -> ms
  const start = new Date("2026-06-01T09:00:00Z");
  const end = new Date(start.getTime() + durationHours * 3600000);
  
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
    `,
    [projet.id, user.id, start.toISOString(), end.toISOString(), description, rate, isBilled, organisation.id],
  );

  return result.rows[0];
}

async function createFixture() {
  const organisation = await createTestOrganisation({ nom: `Org Calc ${Date.now()}` });
  const user = await createTestUser({
    role: "admin",
    password: "Password123!",
    organisation_id: organisation.id,
  });
  const client = await createTestClient({
    organisation_id: organisation.id,
    hourly_rate_defaut: 100,
  });
  const projet = await createTestProjet(client.id, {
    organisation_id: organisation.id,
    nom: `Projet Calc ${Date.now()}`,
    taux_horaire: 100,
  });
  const token = makeToken({
    id: user.id,
    email: user.email,
    role: user.role,
    organisation_id: organisation.id,
  });

  return { organisation, user, client, projet, token };
}

describe("Invoice Calculations & Generation", () => {
  describe("TPS / TVQ calculations (Taxes)", () => {
    test("Calcule correctement le total avec le taux combiné Québec (14.975%)", async () => {
      const fixture = await createFixture();
      // 2 heures à 100$ = 200$
      const entry = await createBillableEntry({ ...fixture, durationHours: 2, rate: 100 });

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: fixture.client.id,
          time_entry_ids: [entry.id],
          tax_rate: 14.975,
        });

      expect(res.status).toBe(201);
      const subtotal = 200;
      const expectedTax = Math.round(subtotal * 0.14975 * 100) / 100; // 29.95
      expect(Number(res.body.subtotal)).toBe(subtotal);
      expect(Number(res.body.tax_total)).toBe(expectedTax);
      expect(Number(res.body.total)).toBe(subtotal + expectedTax);
    });

    test("Calcule correctement sans taxes (0%)", async () => {
      const fixture = await createFixture();
      const entry = await createBillableEntry({ ...fixture, durationHours: 1.5, rate: 100 });

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: fixture.client.id,
          time_entry_ids: [entry.id],
          tax_rate: 0,
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.tax_total)).toBe(0);
      expect(Number(res.body.total)).toBe(Number(res.body.subtotal));
    });
  });

  describe("Total calculation", () => {
    test("Fait la somme correcte de multiples sessions avec durées variées", async () => {
      const fixture = await createFixture();
      // Entry 1: 1.5h @ 100 = 150
      const entry1 = await createBillableEntry({ ...fixture, durationHours: 1.5, rate: 100 });
      // Entry 2: 0.75h @ 200 = 150
      const entry2 = await createBillableEntry({ ...fixture, durationHours: 0.75, rate: 200 });

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: fixture.client.id,
          time_entry_ids: [entry1.id, entry2.id],
          tax_rate: 5,
        });

      expect(res.status).toBe(201);
      const subtotal = 300;
      expect(Number(res.body.subtotal)).toBe(subtotal);
      expect(Number(res.body.tax_total)).toBe(15);
      expect(Number(res.body.total)).toBe(315);
    });
  });

  describe("Rounding and formatting", () => {
    test("Arrondit correctement les décimales complexes (ex: 1/3 d'heure)", async () => {
      const fixture = await createFixture();
      // 0.3333... heures @ 100 = 33.3333...
      const entry = await createBillableEntry({ ...fixture, durationHours: 1/3, rate: 100 });

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: fixture.client.id,
          time_entry_ids: [entry.id],
          tax_rate: 14.975,
        });

      expect(res.status).toBe(201);
      // Math.round((1/3)*100 * 100)/100 = 33.33
      const expectedSubtotal = 33.33;
      const expectedTax = Math.round(expectedSubtotal * 0.14975 * 100) / 100; // 4.99
      expect(Number(res.body.subtotal)).toBe(expectedSubtotal);
      expect(Number(res.body.tax_total)).toBe(expectedTax);
      expect(Number(res.body.total)).toBe(Math.round((expectedSubtotal + expectedTax) * 100) / 100);
    });
  });

  describe("Invoice generation", () => {
    test("Génère l'information correctement (Noms des produits, quantités, prix)", async () => {
      const fixture = await createFixture();
      const entry = await createBillableEntry({ ...fixture, durationHours: 2, rate: 150, description: "Consultation TI" });

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: fixture.client.id,
          time_entry_ids: [entry.id],
          tax_rate: 14.975,
          notes: "Merci de faire affaire avec nous",
        });

      expect(res.status).toBe(201);
      
      const invoice = await request(app).get(`/api/invoices/${res.body.id}`).set("Authorization", `Bearer ${fixture.token}`);
      expect(invoice.status).toBe(200);
      expect(invoice.body.items).toHaveLength(1);
      expect(invoice.body.items[0].description).toBe("Consultation TI");
      expect(Number(invoice.body.items[0].quantity)).toBe(2);
      expect(Number(invoice.body.items[0].unit_rate)).toBe(150);
      expect(Number(invoice.body.items[0].amount)).toBe(300);
      expect(invoice.body.notes).toBe("Merci de faire affaire avec nous");
    });
  });

  describe("Error handling", () => {
    test("Gère les erreurs avec des IDs invalides ou données manquantes", async () => {
      const fixture = await createFixture();

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: fixture.client.id,
          time_entry_ids: [9999999], // id inexistant
          tax_rate: 15,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Aucune entrée de temps/);
    });

    test("Refuse de créer une facture sans client valide", async () => {
      const fixture = await createFixture();
      const entry = await createBillableEntry({ ...fixture, durationHours: 1, rate: 100 });

      const res = await request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          client_id: 999999, // client inexistant
          time_entry_ids: [entry.id],
          tax_rate: 15,
        });

      expect(res.status).toBe(400); // Ne trouve pas l'entrée car elle est jointe sur le client
    });
  });
});
