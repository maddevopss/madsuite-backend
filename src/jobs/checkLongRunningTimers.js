const db = require("../../db");
const logger = require("../config/logger");
const { getLongTimerThresholdHours } = require("../services/timer.service");

async function checkLongRunningTimers({ db: client = db, log = logger } = {}) {
  const thresholdHours = getLongTimerThresholdHours();

  // time_entries/projets/clients/utilisateurs sont sous RLS FORCE : ce check
  // est intentionnellement cross-tenant (monitoring plateforme), résolu via
  // fonction SECURITY DEFINER plutôt qu'une lecture directe qui retournerait
  // toujours 0 ligne sur une connexion non scopée.
  const result = await client.query(
    `SELECT * FROM check_long_running_timers($1::numeric)`,
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
