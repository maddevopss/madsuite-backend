const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../app");
const db = require("../../db");

const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken({ id, email, role, organisation_id }) {
  return jwt.sign(
    {
      id,
      email,
      role,
      organisation_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function createFixture() {
  const organisation = await createTestOrganisation({ nom: `Org Billing ${Date.now()}` });
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
    nom: `Projet Billing ${Date.now()}`,
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

async function createBillableEntry({ projet, user, organisation, description = "Temps facturable" }) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, '2026-06-01T09:00:00Z', '2026-06-01T11:00:00Z', $3, 100, FALSE, $4)
    RETURNING *
    `,
    [projet.id, user.id, description, organisation.id],
  );

  return result.rows[0];
}

describe("billing - anti re-facturation", () => {
  test("une invoice draft ne doit pas permettre la re-facturation des mêmes time_entries", async () => {
    const fixture = await createFixture();

    const entry = await createBillableEntry({
      ...fixture,
      description: "Entrée pour anti-rebilling",
    });

    const payload = {
      client_id: fixture.client.id,
      time_entry_ids: [entry.id],
      tax_rate: 0,
      notes: "draft 1",
      issue_date: new Date().toISOString().slice(0, 10),
    };

    const first = await request(app).post("/api/invoices").set("Authorization", `Bearer ${fixture.token}`).send(payload);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("draft");

    const entryAfterFirst = await db.query("SELECT is_billed, invoice_id FROM time_entries WHERE id = $1", [entry.id]);
    expect(entryAfterFirst.rows[0]).toMatchObject({
      is_billed: true,
    });
    expect(entryAfterFirst.rows[0].invoice_id).toBe(first.body.id);

    const second = await request(app).post("/api/invoices").set("Authorization", `Bearer ${fixture.token}`).send(payload);
    expect([400, 409]).toContain(second.status);

    const itemsForEntry = await db.query(
      `SELECT invoice_id FROM invoice_items WHERE time_entry_id = $1 AND organisation_id = $2`,
      [entry.id, fixture.organisation.id],
    );

    expect(itemsForEntry.rows).toHaveLength(1);
    expect(itemsForEntry.rows[0].invoice_id).toBe(first.body.id);
  });
});
