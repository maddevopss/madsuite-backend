const db = require("../../db");
const logger = require("../config/logger");
const { getLongTimerThresholdHours } = require("../services/timer.service");

async function checkLongRunningTimers({ db: client = db, log = logger } = {}) {
  const thresholdHours = getLongTimerThresholdHours();

  const result = await client.query(
    `
    SELECT
      te.id,
      te.organisation_id,
      te.utilisateur_id,
      te.projet_id,
      te.start_time,
      u.email AS utilisateur_email,
      p.nom AS projet_nom,
      c.nom AS client_nom,
      ROUND(EXTRACT(EPOCH FROM (NOW() - te.start_time)) / 3600, 2) AS duration_hours
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
      AND p.organisation_id = te.organisation_id
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = te.organisation_id
    LEFT JOIN utilisateurs u
      ON u.id = te.utilisateur_id
      AND u.organisation_id = te.organisation_id
    WHERE te.end_time IS NULL
      AND te.organisation_id IS NOT NULL
      AND te.start_time <= NOW() - ($1::numeric * INTERVAL '1 hour')
    ORDER BY te.start_time ASC
    `,
    [thresholdHours],
  );

  if (result.rowCount > 0) {
    log.warn("Timers long-running detectes", {
      count: result.rowCount,
      thresholdHours,
      timers: result.rows.map((timer) => ({
        id: timer.id,
        organisation_id: timer.organisation_id,
        utilisateur_id: timer.utilisateur_id,
        projet_id: timer.projet_id,
        duration_hours: Number(timer.duration_hours || 0),
      })),
    });
  }

  return {
    thresholdHours,
    count: result.rowCount,
    timers: result.rows,
  };
}

module.exports = {
  checkLongRunningTimers,
};
