const db = require("../../db");
const logger = require("../config/logger");
const { DEFAULT_TIMEZONE } = require("../utils/organisationScope");

async function aggregateActivityLogs() {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
      WITH scoped_logs AS (
        SELECT
          al.utilisateur_id,
          al.organisation_id,
          COALESCE(al.app_name, '') AS app_name,
          COALESCE(al.window_title, '') AS window_title,
          al.duration_seconds,
          al.captured_at,
          COALESCE(o.timezone, $1) AS timezone
        FROM activity_logs al
        LEFT JOIN organisations o ON o.id = al.organisation_id
        WHERE al.is_aggregated = false
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
      WHERE captured_at < (((NOW() AT TIME ZONE timezone)::date) AT TIME ZONE timezone)
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
    `,
      [DEFAULT_TIMEZONE],
    );

    // Marquage des logs comme agrégés pour optimiser la future purge
    await client.query(
      `
      UPDATE activity_logs 
      SET is_aggregated = true 
      WHERE is_aggregated = false 
        AND captured_at < (((NOW() AT TIME ZONE $1)::date) AT TIME ZONE $1)
    `,
      [DEFAULT_TIMEZONE],
    );

    await client.query("COMMIT");

    logger.info("Aggregation activity_logs completee");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Erreur aggregation activity_logs", { error });
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { aggregateActivityLogs };
