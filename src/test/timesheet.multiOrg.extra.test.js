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

describe("Timesheet multi-organisation extra", () => {
  beforeAll(async () => {
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS organisation_id INTEGER`);
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
  });

  test("POST /api/timesheet/manual refuse un projet d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `TS Manual A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `TS Manual B ${Date.now()}` });

    const userA = await createTestUser({ role: "employe", organisation_id: orgA.id });

    const clientB = await createTestClient({ nom: `TS Client B ${Date.now()}`, organisation_id: orgB.id });
    const projetB = await createTestProjet(clientB.id, {
      nom: `TS Projet B ${Date.now()}`,
      organisation_id: orgB.id,
      status: "actif",
    });

    const res = await request(app)
      .post("/api/timesheet/manual")
      .set("Authorization", `Bearer ${makeToken(userA)}`)
      .send({
        projet_id: projetB.id,
        start_time: "2026-06-01T09:00:00",
        end_time: "2026-06-01T10:00:00",
        description: "Tentative hors organisation",
      });

    expect(res.statusCode).toBe(404);

    const leak = await db.query(
      `
      SELECT id
      FROM time_entries
      WHERE projet_id = $1
        AND utilisateur_id = $2
      `,
      [projetB.id, userA.id],
    );

    expect(leak.rows).toHaveLength(0);

    await db.query(`DELETE FROM projets WHERE id = $1`, [projetB.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientB.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userA.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("PATCH /api/timesheet/entries/:id ne modifie pas une entrée hors organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `TS Patch A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `TS Patch B ${Date.now()}` });

    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const userB = await createTestUser({ role: "admin", organisation_id: orgB.id });

    const clientB = await createTestClient({ nom: `TS Patch Client B ${Date.now()}`, organisation_id: orgB.id });
    const projetB = await createTestProjet(clientB.id, { nom: `TS Patch Projet B ${Date.now()}`, organisation_id: orgB.id });

    const entryB = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, '2026-06-01 09:00:00', '2026-06-01 10:00:00', 'Original B', 100, false, $3)
      RETURNING id
      `,
      [projetB.id, userB.id, orgB.id],
    );

    const res = await request(app)
      .patch(`/api/timesheet/entries/${entryB.rows[0].id}`)
      .set("Authorization", `Bearer ${makeToken(adminA)}`)
      .send({
        description: "Hack hors org",
      });

    expect(res.statusCode).toBe(404);

    const dbEntry = await db.query(`SELECT description FROM time_entries WHERE id = $1`, [entryB.rows[0].id]);
    expect(dbEntry.rows[0].description).toBe("Original B");

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [entryB.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projetB.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientB.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[adminA.id, userB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });
});
