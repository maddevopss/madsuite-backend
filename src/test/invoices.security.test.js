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

describe("Invoices security", () => {
  test("POST /api/invoices refuse de facturer des time_entry_ids hors organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Invoice A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Invoice B ${Date.now()}` });

    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const adminB = await createTestUser({ role: "admin", organisation_id: orgB.id });

    const clientA = await createTestClient({ nom: `Invoice Client A ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Invoice Client B ${Date.now()}`, organisation_id: orgB.id });

    const projetA = await createTestProjet(clientA.id, { nom: `Invoice Projet A ${Date.now()}`, organisation_id: orgA.id });
    const projetB = await createTestProjet(clientB.id, { nom: `Invoice Projet B ${Date.now()}`, organisation_id: orgB.id });

    const entryA = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, '2026-06-01 09:00:00', '2026-06-01 10:00:00', 'Org A invoice', 100, false, $3)
      RETURNING id
      `,
      [projetA.id, adminA.id, orgA.id],
    );

    const entryB = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, '2026-06-01 09:00:00', '2026-06-01 10:00:00', 'Org B invoice', 100, false, $3)
      RETURNING id
      `,
      [projetB.id, adminB.id, orgB.id],
    );

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${makeToken(adminA)}`)
      .send({
        client_id: clientA.id,
        time_entry_ids: [entryA.rows[0].id, entryB.rows[0].id],
        tax_rate: 0,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message || (res.body.errors && res.body.errors.message) || "").toMatch(/invalides|hors organisation|factur/i);

    const check = await db.query(
      `
      SELECT id, is_billed, invoice_id
      FROM time_entries
      WHERE id = ANY($1::int[])
      ORDER BY id ASC
      `,
      [[entryA.rows[0].id, entryB.rows[0].id]],
    );

    expect(check.rows.every((row) => row.is_billed === false)).toBe(true);
    expect(check.rows.every((row) => row.invoice_id === null)).toBe(true);

    await db.query(`DELETE FROM time_entries WHERE id = ANY($1::int[])`, [[entryA.rows[0].id, entryB.rows[0].id]]);
    await db.query(`DELETE FROM projets WHERE id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[adminA.id, adminB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("POST /api/invoices facture seulement les entrees validees de la bonne organisation", async () => {
    const org = await createTestOrganisation({ nom: `Invoice Valid ${Date.now()}` });
    const admin = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Invoice Valid Client ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, {
      nom: `Invoice Valid Projet ${Date.now()}`,
      organisation_id: org.id,
    });

    const entry = await db.query(
      `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, '2026-06-01 09:00:00', '2026-06-01 11:00:00', 'Valid invoice', 100, false, $3)
    RETURNING id
    `,
      [projet.id, admin.id, org.id],
    );

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${makeToken(admin)}`)
      .send({
        client_id: client.id,
        time_entry_ids: [entry.rows[0].id],
        tax_rate: 0,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("id");

    const updated = await db.query(
      `
    SELECT is_billed, invoice_id
    FROM time_entries
    WHERE id = $1
    `,
      [entry.rows[0].id],
    );

    expect(updated.rows[0].is_billed).toBe(true);
    expect(updated.rows[0].invoice_id).toBe(res.body.id);

    await db.query(
      `
    UPDATE time_entries
    SET is_billed = FALSE,
        invoice_id = NULL
    WHERE id = $1
    `,
      [entry.rows[0].id],
    );

    await db.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [res.body.id]);
    await db.query(`DELETE FROM invoices WHERE id = $1`, [res.body.id]);
    await db.query(`DELETE FROM time_entries WHERE id = $1`, [entry.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [admin.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("un utilisateur non admin ne peut pas muter une facture", async () => {
    const org = await createTestOrganisation({ nom: `Invoice Role ${Date.now()}` });
    const admin = await createTestUser({ role: "admin", organisation_id: org.id });
    const employee = await createTestUser({ role: "employe", organisation_id: org.id });
    const client = await createTestClient({ nom: `Invoice Role Client ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, { nom: `Invoice Role Projet ${Date.now()}`, organisation_id: org.id });

    const entry = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, '2026-06-01 09:00:00', '2026-06-01 10:00:00', 'Role test', 100, false, $3)
      RETURNING id
      `,
      [projet.id, admin.id, org.id],
    );

    const created = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${makeToken(admin)}`)
      .send({
        client_id: client.id,
        time_entry_ids: [entry.rows[0].id],
        tax_rate: 0,
      });

    expect(created.statusCode).toBe(201);

    const actions = await Promise.all([
      request(app)
        .post("/api/invoices")
        .set("Authorization", `Bearer ${makeToken(employee)}`)
        .send({
          client_id: client.id,
          time_entry_ids: [entry.rows[0].id],
          tax_rate: 0,
        }),
      request(app)
        .patch(`/api/invoices/${created.body.id}`)
        .set("Authorization", `Bearer ${makeToken(employee)}`)
        .send({ status: "sent" }),
      request(app)
        .delete(`/api/invoices/${created.body.id}`)
        .set("Authorization", `Bearer ${makeToken(employee)}`),
    ]);

    expect(actions.every((res) => res.statusCode === 403)).toBe(true);

    await db.query(
      `
      UPDATE time_entries
      SET is_billed = FALSE,
          invoice_id = NULL
      WHERE id = $1
      `,
      [entry.rows[0].id],
    );

    await db.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [created.body.id]);
    await db.query(`DELETE FROM invoices WHERE id = $1`, [created.body.id]);
    await db.query(`DELETE FROM time_entries WHERE id = $1`, [entry.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1)`, [[admin.id, employee.id]]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });
});
