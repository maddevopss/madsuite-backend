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

describe("Dashboard multi-organisation", () => {
  beforeAll(async () => {
    await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  });

  test("GET /api/dashboard refuse un token sans organisation_id", async () => {
    const token = jwt.sign(
      {
        id: 999,
        email: "no-org@example.com",
        role: "admin",
        organisation_id: null,
        token_type: "access",
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  test("GET /api/dashboard masque les clients/projets hors organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Dashboard A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Dashboard B ${Date.now()}` });

    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const adminB = await createTestUser({ role: "admin", organisation_id: orgB.id });

    const clientA = await createTestClient({
      nom: `Dashboard Client A ${Date.now()}`,
      organisation_id: orgA.id,
    });

    const clientB = await createTestClient({
      nom: `Dashboard Client B ${Date.now()}`,
      organisation_id: orgB.id,
    });

    const projetA = await createTestProjet(clientA.id, {
      nom: `Dashboard Projet A ${Date.now()}`,
      organisation_id: orgA.id,
    });

    const projetB = await createTestProjet(clientB.id, {
      nom: `Dashboard Projet B ${Date.now()}`,
      organisation_id: orgB.id,
    });

    await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, '2026-06-01 09:00:00', '2026-06-01 10:00:00', 'Org A dashboard', 100, false, $3),
        ($4, $5, '2026-06-01 09:00:00', '2026-06-01 10:00:00', 'Org B dashboard', 999, false, $6)
      `,
      [projetA.id, adminA.id, orgA.id, projetB.id, adminB.id, orgB.id],
    );

    const res = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${makeToken(adminA)}`);

    expect(res.statusCode).toBe(200);

    const ids = res.body.map((row) => row.id);

    expect(ids).toContain(clientA.id);
    expect(ids).not.toContain(clientB.id);

    await db.query(`DELETE FROM time_entries WHERE organisation_id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
    await db.query(`DELETE FROM projets WHERE id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[adminA.id, adminB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });
});
