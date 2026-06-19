const db = require("../../db");
const { aggregateActivityLogs } = require("../jobs/aggregateActivityLogs");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

describe("aggregateActivityLogs integration", () => {
  test("aggregates completed days using organisation timezone", async () => {
    const organisation = await createTestOrganisation();
    const user = await createTestUser({ organisation_id: organisation.id });

    await db.query(`UPDATE organisations SET timezone = $1 WHERE id = $2`, ["America/Montreal", organisation.id]);

    await db.query(
      `
      INSERT INTO activity_logs
        (organisation_id, utilisateur_id, app_name, window_title, duration_seconds, captured_at, type)
      VALUES
        ($1, $2, 'Timezone App', 'Timezone Window', 120, '2026-01-02T04:30:00Z', 'active')
      `,
      [organisation.id, user.id],
    );

    await aggregateActivityLogs();

    const summary = await db.query(
      `
      SELECT total_seconds, activity_date
      FROM activity_daily_summary
      WHERE utilisateur_id = $1
        AND app_name = 'Timezone App'
        AND window_title = 'Timezone Window'
      `,
      [user.id],
    );

    expect(summary.rows).toHaveLength(1);
    expect(Number(summary.rows[0].total_seconds)).toBe(120);
    expect(summary.rows[0].activity_date.toISOString().slice(0, 10)).toBe("2026-01-01");
  });
});
