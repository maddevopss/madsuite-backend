const { runDataPurge } = require("../jobs/dataRetention");
const db = require("../../db");
const { createTestUser } = require("./helpers/testData");

describe("Data Retention Integration Test", () => {
  let orgA, orgB, userA, userB;

  beforeAll(async () => {
    // Nettoyage et création d'organisations de test
    await db.query("DELETE FROM activity_logs");
    await db.query("DELETE FROM organisations WHERE nom LIKE 'Test Retention%'");

    const resA = await db.query(
      "INSERT INTO organisations (nom, retention_activity_logs_days) VALUES ('Test Retention A', 2) RETURNING id",
    );
    const resB = await db.query(
      "INSERT INTO organisations (nom, retention_activity_logs_days) VALUES ('Test Retention B', 10) RETURNING id",
    );
    orgA = resA.rows[0].id;
    orgB = resB.rows[0].id;
    userA = await createTestUser({ organisation_id: orgA });
    userB = await createTestUser({ organisation_id: orgB });
  });

  afterAll(async () => {
    await db.query("DELETE FROM activity_logs WHERE organisation_id IN ($1, $2)", [orgA, orgB]);
    await db.query("DELETE FROM utilisateurs WHERE id IN ($1, $2)", [userA.id, userB.id]);
    await db.query("DELETE FROM organisations WHERE id IN ($1, $2)", [orgA, orgB]);
  });

  it("should purge logs based on specific organisation retention policies", async () => {
    const now = new Date();

    // Logs pour Org A (Rétention: 2 jours)
    await db.query(
      "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at, app_name, is_aggregated) VALUES ($1, $2, $3, 'Stay', true), ($1, $2, $4, 'Purge', true)",
      [orgA, userA.id, now, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)], // 3 jours (trop vieux)
    );

    // Logs pour Org B (Rétention: 10 jours)
    await db.query(
      "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at, app_name, is_aggregated) VALUES ($1, $2, $3, 'Stay', true), ($1, $2, $4, 'Stay', true)",
      [orgB, userB.id, now, new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)], // 5 jours (devrait rester)
    );

    // Exécution de la purge
    await runDataPurge(db.pool);

    // Vérification Org A
    const countA = await db.query("SELECT count(*) FROM activity_logs WHERE organisation_id = $1", [orgA]);
    expect(parseInt(countA.rows[0].count)).toBe(1);

    // Vérification Org B
    const countB = await db.query("SELECT count(*) FROM activity_logs WHERE organisation_id = $1", [orgB]);
    expect(parseInt(countB.rows[0].count)).toBe(2);
  });
});
