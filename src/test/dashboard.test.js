const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient } = require("./helpers/testData");

function makeToken({ role = "admin", id = 999, email = "test@example.com", organisation_id } = {}) {
  return jwt.sign(
    {
      id,
      email,
      role,
      organisation_id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("Dashboard", () => {
  beforeAll(async () => {
    await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  });

  test("GET /api/dashboard refuse sans token", async () => {
    const res = await request(app).get("/api/dashboard");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/dashboard refuse admin sans organisation_id", async () => {
    const token = makeToken({ role: "admin", organisation_id: null });

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  test("GET /api/dashboard accepte admin avec organisation_id et retourne un tableau", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Dashboard Admin ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/dashboard accepte employé avec organisation_id et retourne un tableau", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Dashboard Employe ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "employe",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "employe",
      id: user.id,
      email: user.email,
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/dashboard n'inclut pas les clients supprimés", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Dashboard Deleted ${Date.now()}`,
    });

    const activeClient = await createTestClient({
      nom: `Client dashboard actif ${Date.now()}`,
      organisation_id: organisation.id,
    });

    const deletedClient = await createTestClient({
      nom: `Client dashboard supprimé ${Date.now()}`,
      organisation_id: organisation.id,
    });

    await db.query("UPDATE clients SET deleted_at = NOW() WHERE id = $1", [deletedClient.id]);

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);

    const clientIds = res.body.map((row) => row.id);

    expect(clientIds).toContain(activeClient.id);
    expect(clientIds).not.toContain(deletedClient.id);

    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[activeClient.id, deletedClient.id]]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/dashboard masque les clients d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({
      nom: `Org Dashboard A ${Date.now()}`,
    });

    const orgB = await createTestOrganisation({
      nom: `Org Dashboard B ${Date.now()}`,
    });

    const clientA = await createTestClient({
      nom: `Client dashboard org A ${Date.now()}`,
      organisation_id: orgA.id,
    });

    const clientB = await createTestClient({
      nom: `Client dashboard org B ${Date.now()}`,
      organisation_id: orgB.id,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: orgA.id,
    });

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);

    const clientIds = res.body.map((row) => row.id);

    expect(clientIds).toContain(clientA.id);
    expect(clientIds).not.toContain(clientB.id);

    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("GET /api/dashboard/activity/summary applique les règles DB avant les règles par défaut", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Dashboard Summary ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "admin",
      id: user.id,
      email: user.email,
      organisation_id: organisation.id,
    });

    await db.query(
      `
      INSERT INTO activity_app_rules
        (organisation_id, app_pattern, category, tag, confidence, is_productive, priority, active)
      VALUES ($1, 'unknownapp', 'Pause personnalisée', 'custom-break', 99, FALSE, 999, TRUE)
      `,
      [organisation.id],
    );

    await db.query(
      `
      INSERT INTO activity_daily_summary
        (utilisateur_id, app_name, window_title, total_seconds, activity_date)
      VALUES
        ($1, 'Visual Studio Code', 'code.js', 3600, '2026-05-21'),
        ($1, 'Discord', 'chat', 1800, '2026-05-21'),
        ($1, 'UnknownApp', 'autre', 900, '2026-05-21'),
        ($1, 'NeutralApp', 'autre', 300, '2026-05-21')
      ON CONFLICT (utilisateur_id, app_name, window_title, activity_date)
      DO UPDATE SET total_seconds = EXCLUDED.total_seconds
      `,
      [user.id],
    );

    const res = await request(app)
      .get("/api/dashboard/activity/summary?date_debut=2026-05-01&date_fin=2026-05-22")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);

    const categories = res.body.map((row) => row.category);

    expect(categories).toContain("productif");
    expect(categories).toContain("distraction");
    expect(categories).toContain("neutre");
    expect(res.body.find((row) => row.app_name === "UnknownApp")).toMatchObject({
      category: "distraction",
      activity_category: "Pause personnalisée",
      classification_source: "custom-rule",
    });

    await db.query(
      `
      DELETE FROM activity_daily_summary
      WHERE utilisateur_id = $1
        AND app_name IN ('Visual Studio Code', 'Discord', 'UnknownApp', 'NeutralApp')
      `,
      [user.id],
    );

    await db.query(`DELETE FROM activity_app_rules WHERE organisation_id = $1`, [organisation.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });
});
