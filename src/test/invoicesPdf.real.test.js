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

async function createBillableEntry({ projet, user, organisation }) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, '2026-06-01T09:00:00Z', '2026-06-01T11:00:00Z', 'PDF facture reel', 100, false, $3)
    RETURNING *
    `,
    [projet.id, user.id, organisation.id],
  );

  return result.rows[0];
}

describe("invoice PDF integration", () => {
  test("cree une facture puis genere un buffer PDF reel", async () => {
    const organisation = await createTestOrganisation({ nom: `Org PDF Reel ${Date.now()}` });
    const user = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: organisation.id,
    });
    const client = await createTestClient({
      nom: `Client PDF Reel ${Date.now()}`,
      organisation_id: organisation.id,
    });
    const projet = await createTestProjet(client.id, {
      nom: `Projet PDF Reel ${Date.now()}`,
      organisation_id: organisation.id,
    });
    const entry = await createBillableEntry({ projet, user, organisation });
    const token = makeToken(user, organisation);

    const created = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client_id: client.id,
        time_entry_ids: [entry.id],
        tax_rate: 15,
      });

    expect(created.status).toBe(201);

    const pdf = await request(app)
      .get(`/api/invoices/${created.body.id}/pdf`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");
    expect(pdf.body.length).toBeGreaterThan(500);
  });
});
