const db = require("../../db");
const { aggregateActivityLogs } = require("../jobs/aggregateActivityLogs");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

describe("Aggregation Activity Logs Integration", () => {
  let testUser;
  let testOrganisation;

  beforeAll(async () => {
    testOrganisation = await createTestOrganisation({ nom: `Org Aggregation ${Date.now()}` });
    testUser = await createTestUser({
      role: "admin",
      password: "Password123!",
      organisation_id: testOrganisation.id,
    });
  });

  test("should mark logs as aggregated after successful processing", async () => {
    // 1. Insertion d'un log non agrégé (date passée pour être éligible à l'agrégation)
    const logRes = await db.query(
      `INSERT INTO activity_logs (organisation_id, utilisateur_id, app_name, captured_at, duration_seconds, is_aggregated)
       VALUES ($1, $2, 'TestAggApp', NOW() - INTERVAL '1 day', 120, false)
       RETURNING id`,
      [testOrganisation.id, testUser.id],
    );
    const logId = logRes.rows[0].id;

    // 2. Exécution du job d'agrégation
    await aggregateActivityLogs();

    // 3. Vérification que le log est maintenant marqué comme agrégé
    const checkLog = await db.query("SELECT is_aggregated FROM activity_logs WHERE id = $1", [logId]);

    expect(checkLog.rows[0].is_aggregated).toBe(true);

    // 4. Vérification que le résumé a bien été créé
    const checkSummary = await db.query(
      "SELECT total_seconds FROM activity_daily_summary WHERE utilisateur_id = $1 AND app_name = 'TestAggApp'",
      [testUser.id],
    );
    expect(checkSummary.rowCount).toBeGreaterThan(0);
  });
});
