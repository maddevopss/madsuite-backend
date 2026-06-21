const db = require("../../db");
const logger = require("../config/logger");
const { DEFAULT_TIMEZONE } = require("../utils/organisationScope");

async function aggregateActivityLogs() {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const query = `
      WITH updated_logs AS (
        UPDATE activity_logs
        SET is_aggregated = true
        WHERE is_aggregated = false
          AND captured_at < (((NOW() AT TIME ZONE $1)::date) AT TIME ZONE $1)
        RETURNING utilisateur_id, organisation_id, COALESCE(app_name, '') AS app_name, COALESCE(window_title, '') AS window_title, duration_seconds, captured_at
      ),
      scoped_logs AS (
        SELECT
          ul.utilisateur_id,
          ul.organisation_id,
          ul.app_name,
          ul.window_title,
          ul.duration_seconds,
          ul.captured_at,
          COALESCE(o.timezone, $1) AS timezone
        FROM updated_logs ul
        LEFT JOIN organisations o ON o.id = ul.organisation_id
      )
      INSERT INTO activity_daily_summary (
        utilisateur_id,
        organisation_id,
        app_name,
        window_title,
        total_seconds,
        activity_date
      )
      SELECT
        utilisateur_id,
        organisation_id,
        app_name,
        window_title,
        SUM(duration_seconds) AS total_seconds,
        (captured_at AT TIME ZONE timezone)::date AS activity_date
      FROM scoped_logs
      GROUP BY
        utilisateur_id,
        organisation_id,
        app_name,
        window_title,
        timezone,
        (captured_at AT TIME ZONE timezone)::date
      ON CONFLICT (utilisateur_id, organisation_id, app_name, window_title, activity_date)
      DO UPDATE SET
        total_seconds = activity_daily_summary.total_seconds + EXCLUDED.total_seconds;
    `;

    await client.query(query, [DEFAULT_TIMEZONE]);

    await client.query("COMMIT");
    logger.info("Aggregation activity_logs completee");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // ignore rollback failures
    }
    logger.error("Erreur aggregation activity_logs", { error });
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { aggregateActivityLogs };
