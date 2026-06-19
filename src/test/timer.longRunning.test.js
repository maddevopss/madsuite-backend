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

describe("Timer long running warning", () => {
  beforeAll(async () => {
    process.env.LONG_TIMER_THRESHOLD_HOURS = "8";

    await db.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS organisation_id INTEGER`);
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  });

  test("GET /api/timer/active retourne is_long_running=false pour un timer récent", async () => {
    const organisation = await createTestOrganisation({
      nom: `Timer Long Fresh Org ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });

    const client = await createTestClient({
      nom: `Timer Long Fresh Client ${Date.now()}`,
      organisation_id: organisation.id,
    });

    const projet = await createTestProjet(client.id, {
      nom: `Timer Long Fresh Projet ${Date.now()}`,
      organisation_id: organisation.id,
      status: "actif",
    });

    const entry = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, NOW() - INTERVAL '30 minutes', NULL, 'Timer récent', 100, false, $3)
      RETURNING id
      `,
      [projet.id, user.id, organisation.id],
    );

    const res = await request(app)
      .get("/api/timer/active")
      .set("Authorization", `Bearer ${makeToken(user)}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("id", entry.rows[0].id);
    expect(res.body).toHaveProperty("duration_seconds");
    expect(res.body).toHaveProperty("long_timer_threshold_hours", 8);
    expect(res.body).toHaveProperty("is_long_running", false);
    expect(res.body.warning).toBeNull();

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [entry.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/timer/active retourne is_long_running=true pour un timer de plus de 8h", async () => {
    const organisation = await createTestOrganisation({
      nom: `Timer Long Old Org ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });

    const client = await createTestClient({
      nom: `Timer Long Old Client ${Date.now()}`,
      organisation_id: organisation.id,
    });

    const projet = await createTestProjet(client.id, {
      nom: `Timer Long Old Projet ${Date.now()}`,
      organisation_id: organisation.id,
      status: "actif",
    });

    const entry = await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, NOW() - INTERVAL '9 hours', NULL, 'Timer oublié', 100, false, $3)
      RETURNING id
      `,
      [projet.id, user.id, organisation.id],
    );

    const res = await request(app)
      .get("/api/timer/active")
      .set("Authorization", `Bearer ${makeToken(user)}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("id", entry.rows[0].id);
    expect(res.body).toHaveProperty("is_long_running", true);
    expect(res.body.warning).toMatch(/Timer en cours depuis plus de 8 heures/i);

    await db.query(`DELETE FROM time_entries WHERE id = $1`, [entry.rows[0].id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });
});
