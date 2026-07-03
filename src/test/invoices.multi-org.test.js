const jwt = require("jsonwebtoken");
const request = require("supertest");
const { runWithContext } = require("../core/executionContext");

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
  const organisation = await createTestOrganisation({ nom: `Org Invoice Multi ${Date.now()}` });
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
    nom: `Projet Invoice Multi ${Date.now()}`,
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

describe("invoices.multi-org.routes", () => {
  test("GET /api/invoices/unbilled-entries masque les entrées d'une autre organisation", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    // Créer une entrée non facturée dans l'org A
    const entryA = await createBillableEntry({
      ...fixtureA,
      description: "Entrée Org A",
      isBilled: false,
    });

    // Créer une entrée non facturée dans l'org B
    const entryB = await createBillableEntry({
      ...fixtureB,
      description: "Entrée Org B",
      isBilled: false,
    });

    // L'utilisateur de l'org A demande les entrées non facturées du client A
    const resA = await request(app)
      .get(`/api/invoices/unbilled-entries?client_id=${fixtureA.client.id}`)
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(resA.status).toBe(200);
    expect(resA.body).toHaveLength(1);
    expect(resA.body[0].id).toBe(entryA.id);
    expect(resA.body[0].description).toBe("Entrée Org A");

    // L'utilisateur de l'org B demande les entrées non facturées du client B
    const resB = await request(app)
      .get(`/api/invoices/unbilled-entries?client_id=${fixtureB.client.id}`)
      .set("Authorization", `Bearer ${fixtureB.token}`);

    expect(resB.status).toBe(200);
    expect(resB.body).toHaveLength(1);
    expect(resB.body[0].id).toBe(entryB.id);
    expect(resB.body[0].description).toBe("Entrée Org B");

    // Vérifier que l'utilisateur de l'org A ne peut pas voir les entrées de l'org B
    // même en essayant d'accéder au client de l'org B
    const resCrossOrg = await request(app)
      .get(`/api/invoices/unbilled-entries?client_id=${fixtureB.client.id}`)
      .set("Authorization", `Bearer ${fixtureA.token}`);

    // Devrait retourner 200 mais avec un tableau vide (pas d'entrées pour ce client dans l'org A)
    expect(resCrossOrg.status).toBe(200);
    expect(resCrossOrg.body).toHaveLength(0);
  });

  test("POST /api/invoices crée une facture avec organisation_id correct", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const entryA = await createBillableEntry({
      ...fixtureA,
      description: "Facture Org A",
      isBilled: false,
    });

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixtureA.token}`)
      .send({
        client_id: fixtureA.client.id,
        time_entry_ids: [entryA.id],
        tax_rate: 15,
      });

    expect(res.status).toBe(201);
    expect(Number(res.body.organisation_id)).toBe(fixtureA.organisation.id);
    expect(Number(res.body.organisation_id)).not.toBe(fixtureB.organisation.id);

    // Vérifier que l'entrée est bien marquée comme facturée
    const updatedEntry = await db.query("SELECT is_billed, invoice_id, organisation_id FROM time_entries WHERE id = $1", [entryA.id]);
    expect(updatedEntry.rows[0].is_billed).toBe(true);
    expect(updatedEntry.rows[0].invoice_id).toBe(res.body.id);
    expect(Number(updatedEntry.rows[0].organisation_id)).toBe(fixtureA.organisation.id);
  });

  test("POST /api/invoices refuse de facturer des entrées cross-org", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const entryA = await createBillableEntry({
      ...fixtureA,
      description: "Entrée valide Org A",
      isBilled: false,
    });

    const entryB = await createBillableEntry({
      ...fixtureB,
      description: "Entrée Org B",
      isBilled: false,
    });

    // Essayer de créer une facture avec une entrée d'une autre org
    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixtureA.token}`)
      .send({
        client_id: fixtureA.client.id,
        time_entry_ids: [entryA.id, entryB.id],
        tax_rate: 0,
      });

    // Devrait échouer car entryB n'appartient pas à l'org A
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("invalides");

    // Vérifier que les entrées n'ont pas été modifiées
    const entryAAfter = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entryA.id]);
    const entryBAfter = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entryB.id]);

    expect(entryAAfter.rows[0].is_billed).toBe(false);
    expect(entryAAfter.rows[0].invoice_id).toBeNull();
    expect(entryBAfter.rows[0].is_billed).toBe(false);
    expect(entryBAfter.rows[0].invoice_id).toBeNull();
  });

  test("GET /api/invoices/:id masque les items d'une autre organisation", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();

    const entryA = await createBillableEntry({
      ...fixtureA,
      description: "Entrée Org A",
      isBilled: false,
    });

    // Créer une facture dans l'org A
    const invoiceRes = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${fixtureA.token}`)
      .send({
        client_id: fixtureA.client.id,
        time_entry_ids: [entryA.id],
        tax_rate: 0,
      });

    expect(invoiceRes.status).toBe(201);
    const invoiceId = invoiceRes.body.id;

    // Ajouter un item avec une autre organisation (simulation d'une fuite)
    await db.query(
      `
      INSERT INTO invoice_items (organisation_id, invoice_id, time_entry_id, description, quantity, unit_rate, amount)
      VALUES ($1, $2, NULL, $3, $4, $5, $6)
      `,
      [fixtureB.organisation.id, invoiceId, "Leaked item", 1, 100, 100],
    );

    // L'utilisateur de l'org A récupère la facture
    const getRes = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set("Authorization", `Bearer ${fixtureA.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.items).toHaveLength(1);
    expect(getRes.body.items[0].description).not.toBe("Leaked item");
  });

  test("Vérifier que les time_entries créées par le timer ont organisation_id", async () => {
    const fixture = await createFixture();

    // Créer une entrée via le timer
    const timerRes = await request(app)
      .post("/api/timer/start")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        projet_id: fixture.projet.id,
        description: "Test timer org",
      });

    expect(timerRes.status).toBe(201);
    const entryId = timerRes.body.id;

    // Arrêter le timer
    const stopRes = await request(app)
      .patch("/api/timer/stop")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(stopRes.status).toBe(200);

    // Vérifier que l'entrée a bien organisation_id
    const entry = await db.query("SELECT organisation_id, is_billed, invoice_id FROM time_entries WHERE id = $1", [entryId]);
    expect(entry.rows[0]).toBeDefined();
    expect(Number(entry.rows[0].organisation_id)).toBe(fixture.organisation.id);
    expect(entry.rows[0].is_billed).toBe(false);
    expect(entry.rows[0].invoice_id).toBeNull();
  });
});
