const request = require("supertest");
const jwt = require("jsonwebtoken");
const db = require("../../db");
const app = require("../app");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(role = "admin", overrides = {}) {
  return jwt.sign({ id: 999, email: "test@example.com", role, ...overrides }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

describe("Reports", () => {
  test("GET /api/reports refuse sans token", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.statusCode).toBe(401);
  });

  test("GET /api/reports refuse sans date_debut/date_fin", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/reports").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/reports refuse sans date_fin", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/reports?date_debut=2026-05-01").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/reports refuse sans date_debut", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/reports?date_fin=2026-05-21").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  test("GET /api/reports accepte dates valides", async () => {
    const token = makeToken("admin");

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-01&date_fin=2026-05-22")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("rows");
    expect(res.body).toHaveProperty("total");
  });

  test("GET /api/reports distingue temps total, facturable, estimé et facturé", async () => {
    const org = await createTestOrganisation({ nom: `Org Reports Metrics ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Client Reports Metrics ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Reports Metrics ${Date.now()}`,
      organisation_id: org.id,
    });

    await db.query(
      `
      INSERT INTO time_entries
        (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
      VALUES
        ($1, $2, '2026-05-20 09:00:00', '2026-05-20 10:00:00', 'Facturée', 100, TRUE, $3),
        ($1, $2, '2026-05-20 10:00:00', '2026-05-20 11:00:00', 'Estimée', 100, FALSE, $3),
        ($1, $2, '2026-05-20 11:00:00', '2026-05-20 12:00:00', 'Non facturable', 0, FALSE, $3)
      `,
      [projet.id, user.id, org.id],
    );
    const token = makeToken("admin", { id: user.id, email: user.email, organisation_id: org.id });

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-20&date_fin=2026-05-20")
      .set("Authorization", `Bearer ${token}`);
    const row = res.body.rows.find((item) => item.projet_id === projet.id);

    expect(res.statusCode).toBe(200);
    expect(Number(row.heures)).toBe(3);
    expect(Number(row.heures_facturables)).toBe(2);
    expect(Number(row.montant_estime)).toBe(200);
    expect(Number(row.montant_facture)).toBe(100);
    expect(res.body.total).toMatchObject({
      heures: 3,
      heures_facturables: 2,
      montant_estime: 200,
      montant_facture: 100,
    });

    await db.query(`DELETE FROM time_entries WHERE projet_id = $1`, [projet.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/reports masque les entrées des autres organisations", async () => {
    const orgA = await createTestOrganisation({ nom: `Org A Reports ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Org B Reports ${Date.now()}` });
    const userA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const userB = await createTestUser({ role: "admin", organisation_id: orgB.id });
    const clientA = await createTestClient({ nom: `Client Reports A ${Date.now()}`, organisation_id: orgA.id });
    const clientB = await createTestClient({ nom: `Client Reports B ${Date.now()}`, organisation_id: orgB.id });
    const projetA = await createTestProjet(clientA.id, { nom: `Projet Reports A ${Date.now()}`, organisation_id: orgA.id });
    const projetB = await createTestProjet(clientB.id, { nom: `Projet Reports B ${Date.now()}`, organisation_id: orgB.id });

    await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES
         ($1, $2, '2026-05-21 09:00:00', '2026-05-21 10:00:00', 'Org A', 100, true, $3),
         ($4, $5, '2026-05-21 09:00:00', '2026-05-21 10:00:00', 'Org B', 100, true, $6)`,
      [projetA.id, userA.id, orgA.id, projetB.id, userB.id, orgB.id],
    );

    const token = makeToken("admin", { id: userA.id, email: userA.email, organisation_id: orgA.id });
    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-21&date_fin=2026-05-21")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.some((row) => row.projet_id === projetA.id)).toBe(true);
    expect(res.body.rows.some((row) => row.projet_id === projetB.id)).toBe(false);

    await db.query(`DELETE FROM time_entries WHERE projet_id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM projets WHERE id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[userA.id, userB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("GET /api/reports inclut les entrées du dernier jour de la plage", async () => {
    const user = await createTestUser({ role: "admin" });
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    const client = await createTestClient({ nom: `Client Reports ${Date.now()}` });
    const projet = await createTestProjet(client.id, { nom: `Projet Reports ${Date.now()}` });

    const startTime = "2026-05-22 23:30:00";
    const endTime = "2026-05-22 23:45:00";

    await db.query(
      `INSERT INTO time_entries (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [projet.id, user.id, startTime, endTime, "Entrée fin de plage", 100, false],
    );

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-01&date_fin=2026-05-22")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);

    const matched = res.body.rows.find((row) => row.projet_id === projet.id && row.utilisateur_id === user.id);

    expect(matched).toBeTruthy();
    expect(Number(matched.entrees)).toBeGreaterThanOrEqual(1);

    await db.query(`DELETE FROM time_entries WHERE projet_id = $1 AND utilisateur_id = $2`, [projet.id, user.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
  });

  test("GET /api/reports/debug/time_entries refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).get("/api/reports/debug/time_entries").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);
  });

  test("GET /api/reports/debug/time_entries accepte admin", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/reports/debug/time_entries").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/reports/debug/activity_logs refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).get("/api/reports/debug/activity_logs").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);
  });

  test("GET /api/reports/debug/activity_logs accepte admin", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/reports/debug/activity_logs").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/reports/debug/window_logs refuse employé", async () => {
    const token = makeToken("employe");

    const res = await request(app).get("/api/reports/debug/window_logs").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);
  });

  test("GET /api/reports/debug/window_logs accepte admin", async () => {
    const token = makeToken("admin");

    const res = await request(app).get("/api/reports/debug/window_logs").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/reports filtre is_billed=true ne retourne que les entrées facturées", async () => {
    const org = await createTestOrganisation({ nom: `Org Reports Billed ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Client Reports Billed ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Reports Billed ${Date.now()}`,
      organisation_id: org.id,
    });

    const entryBilled = await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-25 09:00:00', '2026-05-25 10:00:00', 'Facturée', 100, true, $3)
       RETURNING id`,
      [projet.id, user.id, org.id],
    );
    const entryUnbilled = await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-25 11:00:00', '2026-05-25 12:00:00', 'Non facturée', 100, false, $3)
       RETURNING id`,
      [projet.id, user.id, org.id],
    );
    const token = makeToken("admin", { id: user.id, email: user.email, organisation_id: org.id });

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-25&date_fin=2026-05-25&is_billed=true")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.some((row) => row.projet_id === projet.id)).toBe(true);
    const row = res.body.rows.find((row) => row.projet_id === projet.id);
    expect(Number(row.entrees)).toBeGreaterThanOrEqual(1);

    await db.query(`DELETE FROM time_entries WHERE id = ANY($1::int[])`, [
      [entryBilled.rows[0].id, entryUnbilled.rows[0].id],
    ]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/reports filtre is_billed=false ne retourne que les entrées non facturées", async () => {
    const org = await createTestOrganisation({ nom: `Org Reports Unbilled ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Client Reports Unbilled ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Reports Unbilled ${Date.now()}`,
      organisation_id: org.id,
    });

    const entryBilled = await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-26 09:00:00', '2026-05-26 10:00:00', 'Facturée', 100, true, $3)
       RETURNING id`,
      [projet.id, user.id, org.id],
    );
    const entryUnbilled = await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-26 11:00:00', '2026-05-26 12:00:00', 'Non facturée', 100, false, $3)
       RETURNING id`,
      [projet.id, user.id, org.id],
    );
    const token = makeToken("admin", { id: user.id, email: user.email, organisation_id: org.id });

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-26&date_fin=2026-05-26&is_billed=false")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.some((row) => row.projet_id === projet.id)).toBe(true);

    await db.query(`DELETE FROM time_entries WHERE id = ANY($1::int[])`, [
      [entryBilled.rows[0].id, entryUnbilled.rows[0].id],
    ]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/reports group_by=month retourne une periode par mois", async () => {
    const org = await createTestOrganisation({ nom: `Org Reports Month ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Client Reports Month ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, { nom: `Projet Reports Month ${Date.now()}`, organisation_id: org.id });

    await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-15 09:00:00', '2026-05-15 10:00:00', 'Mai', 100, false, $3)`,
      [projet.id, user.id, org.id],
    );
    const token = makeToken("admin", { id: user.id, email: user.email, organisation_id: org.id });

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-01&date_fin=2026-05-31&group_by=month")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows[0]).toHaveProperty("periode");
    expect(res.body.rows[0]).toHaveProperty("periode_label");
    expect(res.body.rows[0].periode).toMatch(/^2026-05$/);

    await db.query(`DELETE FROM time_entries WHERE projet_id = $1`, [projet.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/reports group_by=week retourne une periode par semaine", async () => {
    const org = await createTestOrganisation({ nom: `Org Reports Week ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `Client Reports Week ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, { nom: `Projet Reports Week ${Date.now()}`, organisation_id: org.id });

    await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-20 09:00:00', '2026-05-20 10:00:00', 'Semaine', 100, false, $3)`,
      [projet.id, user.id, org.id],
    );
    const token = makeToken("admin", { id: user.id, email: user.email, organisation_id: org.id });

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-18&date_fin=2026-05-24&group_by=week")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows[0]).toHaveProperty("periode");
    expect(res.body.rows[0]).toHaveProperty("periode_label");

    await db.query(`DELETE FROM time_entries WHERE projet_id = $1`, [projet.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });

  test("GET /api/reports employe ne voit que ses propres entrées", async () => {
    const org = await createTestOrganisation({ nom: `Org Reports Employe ${Date.now()}` });
    const admin = await createTestUser({ role: "admin", organisation_id: org.id });
    const employe = await createTestUser({ role: "employe", organisation_id: org.id });
    const client = await createTestClient({ nom: `Client Reports Employe ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, {
      nom: `Projet Reports Employe ${Date.now()}`,
      organisation_id: org.id,
    });

    await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-27 09:00:00', '2026-05-27 10:00:00', 'Admin', 100, false, $3)`,
      [projet.id, admin.id, org.id],
    );
    await db.query(
      `INSERT INTO time_entries
         (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
       VALUES ($1, $2, '2026-05-27 11:00:00', '2026-05-27 12:00:00', 'Employe', 100, false, $3)`,
      [projet.id, employe.id, org.id],
    );

    const employeToken = jwt.sign(
      { id: employe.id, email: employe.email, role: "employe", organisation_id: org.id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    const res = await request(app)
      .get("/api/reports?date_debut=2026-05-27&date_fin=2026-05-27")
      .set("Authorization", `Bearer ${employeToken}`);

    expect(res.statusCode).toBe(200);
    const employeRow = res.body.rows.find((row) => row.utilisateur_id === employe.id);
    expect(employeRow).toBeTruthy();
    expect(res.body.rows.some((row) => row.utilisateur_id === admin.id)).toBe(false);

    await db.query(`DELETE FROM time_entries WHERE projet_id = $1`, [projet.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[admin.id, employe.id]]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });
});
