const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");

const { createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function createTimeEntry({
  userId,
  projetId,
  startTime = "2026-05-24 09:00:00",
  endTime = "2026-05-24 10:30:00",
  description = "Développement du module de résumé quotidien",
  isBilled = true,
}) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (
        utilisateur_id,
        projet_id,
        start_time,
        end_time,
        description,
        hourly_rate_used,
        is_billed
      )
    VALUES
      ($1, $2, $3, $4, $5, 100, $6)
    RETURNING *
    `,
    [userId, projetId, startTime, endTime, description, isBilled],
  );

  return result.rows[0];
}

describe("Day Summary", () => {
  test("GET /api/day-summary/:date refuse sans token", async () => {
    const res = await request(app).get("/api/day-summary/2026-05-24");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/day-summary/:date refuse date invalide", async () => {
    const user = await createTestUser();
    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/24-05-2026").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message");
  });

  test("GET /api/day-summary/:date retourne résumé vide si aucune entrée", async () => {
    const user = await createTestUser();
    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      summary_date: "2026-05-24",
      utilisateur_id: user.id,
      total_seconds: 0,
      billable_seconds: 0,
      entries_count: 0,
      projects: [],
    });

    expect(res.body.summary_text).toContain("Résumé du 2026-05-24");
    expect(res.body.summary_text).toContain("Temps total : 0h00");
    expect(res.body.summary_text).toContain("- Aucun projet détecté");
    expect(res.body.summary_text).toContain("- Aucune entrée");
  });

  test("GET /api/day-summary/:date calcule total, facturable, projets et activités", async () => {
    const user = await createTestUser();
    const client = await createTestClient();
    const projet = await createTestProjet(client.id, {
      nom: "MADSuite Backend",
    });

    await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      startTime: "2026-05-24 09:00:00",
      endTime: "2026-05-24 10:30:00",
      description: "Développement API résumé quotidien",
      isBilled: true,
    });

    await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      startTime: "2026-05-24 11:00:00",
      endTime: "2026-05-24 11:30:00",
      description: "Tests backend",
      isBilled: false,
    });

    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.summary_date).toBe("2026-05-24");
    expect(res.body.utilisateur_id).toBe(user.id);
    expect(res.body.entries_count).toBe(2);
    expect(res.body.total_seconds).toBe(7200);
    expect(res.body.billable_seconds).toBe(5400);
    expect(res.body.projects).toContain("MADSuite Backend");

    expect(res.body.summary_text).toContain("Temps total : 2h00");
    expect(res.body.summary_text).toContain("Temps potentiellement facturable : 1h30");
    expect(res.body.summary_text).toContain("- MADSuite Backend");
    expect(res.body.summary_text).toContain("- Développement API résumé quotidien");
    expect(res.body.summary_text).toContain("- Tests backend");
  });

  test("GET /api/day-summary/:date ignore les entrées d'un autre utilisateur", async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    await createTimeEntry({
      userId: otherUser.id,
      projetId: projet.id,
      startTime: "2026-05-24 09:00:00",
      endTime: "2026-05-24 12:00:00",
      description: "Entrée autre utilisateur",
      isBilled: true,
    });

    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.entries_count).toBe(0);
    expect(res.body.total_seconds).toBe(0);
    expect(res.body.summary_text).not.toContain("Entrée autre utilisateur");
  });

  test("GET /api/day-summary/:date ignore les entrées d'une autre date", async () => {
    const user = await createTestUser();
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      startTime: "2026-05-23 09:00:00",
      endTime: "2026-05-23 10:00:00",
      description: "Entrée hier",
      isBilled: true,
    });

    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.entries_count).toBe(0);
    expect(res.body.total_seconds).toBe(0);
    expect(res.body.summary_text).not.toContain("Entrée hier");
  });

  test("GET /api/day-summary/:date remplace une description vide", async () => {
    const user = await createTestUser();
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    await createTimeEntry({
      userId: user.id,
      projetId: projet.id,
      startTime: "2026-05-24 09:00:00",
      endTime: "2026-05-24 10:00:00",
      description: "",
      isBilled: true,
    });

    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.entries_count).toBe(1);
    expect(res.body.summary_text).toContain("- Entrée sans description");
  });

  test("GET /api/day-summary/:date compte 0 seconde si end_time est null", async () => {
    const user = await createTestUser();
    const client = await createTestClient();
    const projet = await createTestProjet(client.id);

    await db.query(
      `
      INSERT INTO time_entries
        (
          utilisateur_id,
          projet_id,
          start_time,
          end_time,
          description,
          hourly_rate_used,
          is_billed
        )
      VALUES
        ($1, $2, '2026-05-24 09:00:00', NULL, 'Timer actif', 100, true)
      `,
      [user.id, projet.id],
    );

    const token = makeToken(user);

    const res = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.entries_count).toBe(1);
    expect(res.body.total_seconds).toBe(0);
    expect(res.body.billable_seconds).toBe(0);
    expect(res.body.summary_text).toContain("- Timer actif");
  });

  test("PUT /api/day-summary/:date sauvegarde un resume edite", async () => {
    const user = await createTestUser();
    const token = makeToken(user);

    const saved = await request(app).put("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`).send({
      summary_text: "Resume ajuste manuellement.",
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.body.summary_text).toBe("Resume ajuste manuellement.");
    expect(saved.body.is_edited).toBe(true);

    const fetched = await request(app).get("/api/day-summary/2026-05-24").set("Authorization", `Bearer ${token}`);

    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.summary_text).toBe("Resume ajuste manuellement.");
    expect(fetched.body.generated_summary_text).toContain("Temps total");
    expect(fetched.body.is_edited).toBe(true);
  });
});
