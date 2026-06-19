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

describe("Timer multi-organisation", () => {
  beforeAll(async () => {
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS organisation_id INTEGER`);
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS note TEXT`);
    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  });

  test("POST /api/timer/start refuse un projet d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Timer A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Timer B ${Date.now()}` });

    const userA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Timer Client B ${Date.now()}`, organisation_id: orgB.id });
    const projetB = await createTestProjet(clientB.id, {
      nom: `Timer Projet B ${Date.now()}`,
      organisation_id: orgB.id,
      status: "actif",
    });

    const res = await request(app)
      .post("/api/timer/start")
      .set("Authorization", `Bearer ${makeToken(userA)}`)
      .send({
        projet_id: projetB.id,
        description: "Tentative hors organisation",
      });

    expect(res.statusCode).toBe(404);

    const leakedEntry = await db.query(
      `
      SELECT id
      FROM time_entries
      WHERE projet_id = $1
        AND utilisateur_id = $2
      `,
      [projetB.id, userA.id],
    );

    expect(leakedEntry.rows).toHaveLength(0);

    await db.query(`DELETE FROM time_entries WHERE utilisateur_id = $1`, [userA.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projetB.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientB.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userA.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("POST /api/timer/start démarre un projet de la même organisation", async () => {
    const org = await createTestOrganisation({ nom: `Timer Same Org ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Timer Client ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, {
      nom: `Timer Projet ${Date.now()}`,
      organisation_id: org.id,
      status: "actif",
    });

    const res = await request(app)
      .post("/api/timer/start")
      .set("Authorization", `Bearer ${makeToken(user)}`)
      .send({
        projet_id: projet.id,
        description: "Timer valide",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("projet_id", projet.id);
    expect(Number(res.body.organisation_id)).toBe(org.id);

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [res.body.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/timer/today-projects masque les projets d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Timer Today A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Timer Today B ${Date.now()}` });

    const userA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const userB = await createTestUser({ role: "admin", organisation_id: orgB.id });

    const clientA = await createTestClient({ nom: `Timer Today Client A ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Timer Today Client B ${Date.now()}`, organisation_id: orgB.id });

    const projetA = await createTestProjet(clientA.id, {
      nom: `Timer Today Projet A ${Date.now()}`,
      organisation_id: orgA.id,
    });
    const projetB = await createTestProjet(clientB.id, {
      nom: `Timer Today Projet B ${Date.now()}`,
      organisation_id: orgB.id,
    });

    await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'Today A', 100, false, $3),
        ($4, $5, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'Today B', 100, false, $6)
      `,
      [projetA.id, userA.id, orgA.id, projetB.id, userB.id, orgB.id],
    );

    const res = await request(app)
      .get("/api/timer/today-projects")
      .set("Authorization", `Bearer ${makeToken(userA)}`);

    expect(res.statusCode).toBe(200);

    const projetIds = res.body.map((row) => row.projet_id);

    expect(projetIds).toContain(projetA.id);
    expect(projetIds).not.toContain(projetB.id);

    await db.query(`DELETE FROM time_entries WHERE organisation_id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
    await db.query(`DELETE FROM projets WHERE id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[userA.id, userB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });
});
