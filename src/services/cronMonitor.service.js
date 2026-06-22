const { pool } = require("../../db");
const logger = require("../config/logger");
const cronRegistry = require("../config/cron_registry");

/**
 * Record the start of a cron job execution
 */
async function recordJobStart(jobName) {
  try {
    const query = `
      INSERT INTO cron_execution_logs (job_name, status)
      VALUES ($1, 'STARTED')
      RETURNING id
    `;
    const res = await pool.query(query, [jobName]);
    return res.rows[0].id;
  } catch (error) {
    logger.error(`Erreur lors de l'enregistrement du démarrage du cron ${jobName}:`, error);
    return null;
  }
}

/**
 * Record the success of a cron job execution
 */
async function recordJobSuccess(logId) {
  if (!logId) return;
  try {
    const query = `
      UPDATE cron_execution_logs
      SET status = 'SUCCESS', completed_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    await pool.query(query, [logId]);
  } catch (error) {
    logger.error(`Erreur lors de l'enregistrement du succès du cron log ${logId}:`, error);
  }
}

/**
 * Record the failure of a cron job execution
 */
async function recordJobFailure(logId, errorMessage) {
  if (!logId) return;
  try {
    const query = `
      UPDATE cron_execution_logs
      SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP, error_message = $2
      WHERE id = $1
    `;
    await pool.query(query, [logId, errorMessage]);
  } catch (error) {
    logger.error(`Erreur lors de l'enregistrement de l'échec du cron log ${logId}:`, error);
  }
}

/**
 * Record partial success of a cron job execution
 */
async function recordJobPartialSuccess(logId, metadata) {
  if (!logId) return;
  try {
    const query = `
      UPDATE cron_execution_logs
      SET status = 'PARTIAL_SUCCESS', completed_at = CURRENT_TIMESTAMP, error_summary = $2
      WHERE id = $1
    `;
    await pool.query(query, [logId, metadata ? JSON.stringify(metadata) : null]);
  } catch (error) {
    logger.error(`Erreur lors de l'enregistrement du partial success du cron log ${logId}:`, error);
  }
}

/**
 * Get health summary of all tracked cron jobs
 */
async function getCronHealth() {
  const query = `
    SELECT 
      job_name,
      MAX(CASE WHEN status = 'STARTED' THEN started_at END) as last_started_at,
      MAX(CASE WHEN status = 'SUCCESS' THEN completed_at END) as last_success_at,
      MAX(CASE WHEN status = 'FAILED' THEN completed_at END) as last_failed_at,
      (
        SELECT status 
        FROM cron_execution_logs c2 
        WHERE c2.job_name = c1.job_name 
        ORDER BY started_at DESC LIMIT 1
      ) as current_status
    FROM cron_execution_logs c1
    GROUP BY job_name
  `;
  const { rows } = await pool.query(query);
  return rows;
}

/**
 * Check for stale jobs based on cron_registry schedules.
 */
async function checkStaleJobs() {
  try {
    const health = await getCronHealth();
    const now = new Date();

    for (const job of health) {
      const config = cronRegistry[job.job_name];
      if (!config) continue;

      const { frequencyHours, criticality } = config;
      // Convert frequency to ms and add a 1-hour buffer for small execution delays
      const expectedIntervalMs = (frequencyHours + 1) * 60 * 60 * 1000;
      
      const lastSuccess = job.last_success_at ? new Date(job.last_success_at) : null;
      
      // If never succeeded or last success is older than expected interval
      if (!lastSuccess || (now.getTime() - lastSuccess.getTime() > expectedIntervalMs)) {
        logger.warn(`Cron en retard: ${job.job_name} (Criticité: ${criticality})`);
        
        // Notify admins for HIGH/MEDIUM criticality
        if (criticality === 'HIGH' || criticality === 'MEDIUM') {
          await pool.query(`
            INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
            SELECT organisation_id, id, 'system_alert', $1 
            FROM utilisateurs 
            WHERE role = 'admin'
          `, [`ALERTE CRON: Le job ${job.job_name} n'a pas tourné avec succès depuis plus de ${frequencyHours}h.`]);
        }

        // Audit log
        try {
          await pool.query(`
            INSERT INTO audit_logs (action, details)
            VALUES ($1, $2)
          `, ['CRON_STALE_ALERT', JSON.stringify({ job_name: job.job_name, criticality, expected_frequency_hours: frequencyHours, last_success: lastSuccess })]);
        } catch (e) {
          logger.warn("Could not insert into audit_logs", e);
        }
      }
    }
  } catch (error) {
    logger.error(`Erreur lors de la vérification des crons en retard:`, error);
  }
}

/**
 * Nettoie les logs cron avec une rétention différenciée selon le statut:
 * SUCCESS (et autres) -> 7 jours
 * PARTIAL_SUCCESS -> 30 jours
 * FAILED -> 90 jours
 */
async function cleanupOldLogs() {
  try {
    const query = `
      DELETE FROM cron_execution_logs 
      WHERE 
        keep_for_debug = false AND (
          (status = 'FAILED' AND started_at < NOW() - INTERVAL '90 days') OR
          (status = 'PARTIAL_SUCCESS' AND started_at < NOW() - INTERVAL '30 days') OR
          (status NOT IN ('FAILED', 'PARTIAL_SUCCESS') AND started_at < NOW() - INTERVAL '14 days')
        )
    `;
    const res = await pool.query(query);
    logger.info(`Cron cleanup: ${res.rowCount} logs supprimés (Rétention différenciée).`);
  } catch (error) {
    logger.error(`Erreur lors du nettoyage des vieux logs cron:`, error);
  }
}

module.exports = {
  recordJobStart,
  recordJobSuccess,
  recordJobFailure,
  recordJobPartialSuccess,
  getCronHealth,
  checkStaleJobs,
  cleanupOldLogs
};
