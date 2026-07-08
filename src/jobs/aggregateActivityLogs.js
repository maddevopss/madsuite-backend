const db = require("../../db");
const logger = require("../config/logger");
const { DEFAULT_TIMEZONE } = require("../utils/organisationScope");

async function aggregateActivityLogs(options = {}) {
  const client = await db.connect();
  const targetOrganisationId = options.organisationId ?? null;

  try {
    await client.query("BEGIN");

    const orgResult = targetOrganisationId
      ? await client.query(
          "SELECT $2::int AS id, COALESCE((SELECT timezone FROM organisations WHERE id = $2), $1) AS timezone",
          [DEFAULT_TIMEZONE, targetOrganisationId],
        )
      : await client.query(
          "SELECT id, COALESCE(timezone, $1) AS timezone FROM organisations",
          [DEFAULT_TIMEZONE],
        );

    const query = `
      WITH updated_logs AS (
        UPDATE activity_logs
        SET is_aggregated = true
        WHERE organisation_id = $2
          AND is_aggregated = false
          AND captured_at < (((NOW() AT TIME ZONE $1)::date) AT TIME ZONE $1)
        RETURNING utilisateur_id, organisation_id, COALESCE(app_name, '') AS app_name, COALESCE(window_title, '') AS window_title, duration_seconds, captured_at
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
        (captured_at AT TIME ZONE $1)::date AS activity_date
      FROM updated_logs
      GROUP BY
        utilisateur_id,
        organisation_id,
        app_name,
        window_title,
        (captured_at AT TIME ZONE $1)::date
      ON CONFLICT (utilisateur_id, organisation_id, app_name, window_title, activity_date)
      DO UPDATE SET
        total_seconds = activity_daily_summary.total_seconds + EXCLUDED.total_seconds;
    `;

    for (const org of orgResult.rows) {
      await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(org.id)]);
      await client.query(query, [org.timezone || DEFAULT_TIMEZONE, org.id]);
    }

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
