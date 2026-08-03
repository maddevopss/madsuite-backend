/**
 * Job Lock Tracker
 *
 * Monitors job lock acquisitions and releases:
 * - Tracks when locks are acquired and released
 * - Detects stuck locks (held beyond timeout)
 * - Detects deadlocks (circular lock dependencies)
 * - Reports on lock contention
 */

const db = require("../../db");
const logger = require("../config/logger");
const os = require("os");

const HOSTNAME = os.hostname();

/**
 * Record lock acquisition
 */
async function recordLockAcquired(jobName) {
  try {
    await db.pool.query(`
      INSERT INTO job_lock_tracking (
        job_name,
        instance_hostname,
        status
      )
      VALUES ($1, $2, 'HELD')
      RETURNING id
    `, [jobName, HOSTNAME]);
  } catch (error) {
    logger.error(`Error recording lock acquisition for ${jobName}:`, error);
  }
}

/**
 * Record lock release
 */
async function recordLockReleased(jobName) {
  try {
    const result = await db.pool.query(`
      UPDATE job_lock_tracking
      SET
        released_at = CURRENT_TIMESTAMP,
        duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - acquired_at))::INT,
        status = 'RELEASED'
      WHERE job_name = $1
        AND status = 'HELD'
      ORDER BY acquired_at DESC
      LIMIT 1
      RETURNING id, duration_seconds
    `, [jobName]);

    if (result.rows.length > 0 && result.rows[0].duration_seconds > 300) {
      logger.warn(`Job lock held for ${result.rows[0].duration_seconds}s: ${jobName}`);
    }
  } catch (error) {
    logger.error(`Error recording lock release for ${jobName}:`, error);
  }
}

/**
 * Detect stuck locks (held beyond max_delay_seconds + timeout_seconds)
 */
async function detectStuckLocks() {
  try {
    const result = await db.pool.query(`
      SELECT
        jlt.job_name,
        jlt.instance_hostname,
        jlt.acquired_at,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - jlt.acquired_at))::INT as held_seconds,
        jr.max_delay_seconds,
        jr.timeout_seconds,
        jr.criticality,
        jr.owner_contact_email
      FROM job_lock_tracking jlt
      JOIN job_registry jr ON jlt.job_name = jr.job_name
      WHERE jlt.status = 'HELD'
        AND (CURRENT_TIMESTAMP - jlt.acquired_at) > ((jr.timeout_seconds + jr.max_delay_seconds) * INTERVAL '1 second')
      ORDER BY held_seconds DESC
    `);

    const stuckLocks = result.rows;

    for (const lock of stuckLocks) {
      logger.error(`STUCK LOCK DETECTED: ${lock.job_name} held for ${lock.held_seconds}s on ${lock.instance_hostname}`);

      // Mark as timed out
      await db.pool.query(`
        UPDATE job_lock_tracking
        SET status = 'TIMED_OUT'
        WHERE job_name = $1
          AND instance_hostname = $2
          AND acquired_at = $3
      `, [lock.job_name, lock.instance_hostname, lock.acquired_at]);

      // Notify owner
      if (lock.owner_contact_email && lock.criticality !== 'LOW') {
        await notifyJobOwner(lock.job_name, lock.owner_contact_email, {
          type: 'STUCK_LOCK',
          heldSeconds: lock.held_seconds,
          maxDelaySeconds: lock.max_delay_seconds,
          timeoutSeconds: lock.timeout_seconds,
          hostname: lock.instance_hostname
        });
      }
    }

    return stuckLocks;
  } catch (error) {
    logger.error("Error detecting stuck locks:", error);
    return [];
  }
}

/**
 * Get lock contention metrics
 */
async function getLockContention(jobName) {
  try {
    const result = await db.pool.query(`
      SELECT
        job_name,
        COUNT(*) as total_locks,
        COUNT(CASE WHEN status = 'HELD' THEN 1 END) as active_locks,
        COUNT(CASE WHEN status = 'RELEASED' THEN 1 END) as released_locks,
        COUNT(CASE WHEN status = 'TIMED_OUT' THEN 1 END) as timed_out_locks,
        AVG(CASE WHEN status = 'RELEASED' THEN duration_seconds END)::INT as avg_hold_seconds,
        MAX(CASE WHEN status = 'RELEASED' THEN duration_seconds END)::INT as max_hold_seconds,
        MIN(CASE WHEN status = 'RELEASED' THEN duration_seconds END)::INT as min_hold_seconds
      FROM job_lock_tracking
      WHERE job_name = $1
        AND acquired_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
      GROUP BY job_name
    `, [jobName]);

    return result.rows[0] || null;
  } catch (error) {
    logger.error(`Error getting lock contention for ${jobName}:`, error);
    return null;
  }
}

/**
 * Get global lock contention summary
 */
async function getLockContentionSummary() {
  try {
    const result = await db.pool.query(`
      SELECT
        jlt.job_name,
        jr.display_name,
        jr.criticality,
        COUNT(*) as total_locks_24h,
        COUNT(CASE WHEN jlt.status = 'HELD' THEN 1 END) as currently_held,
        COUNT(CASE WHEN jlt.status = 'TIMED_OUT' THEN 1 END) as timeouts_24h,
        AVG(CASE WHEN jlt.status = 'RELEASED' THEN jlt.duration_seconds END)::INT as avg_hold_seconds,
        MAX(CASE WHEN jlt.acquired_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
            THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - jlt.acquired_at))::INT END) as max_held_seconds
      FROM job_lock_tracking jlt
      JOIN job_registry jr ON jlt.job_name = jr.job_name
      WHERE jlt.acquired_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
      GROUP BY jlt.job_name, jr.display_name, jr.criticality
      ORDER BY max_held_seconds DESC NULLS LAST
    `);

    return result.rows;
  } catch (error) {
    logger.error("Error getting lock contention summary:", error);
    return [];
  }
}

/**
 * Clean up old lock tracking records
 */
async function cleanupOldLockRecords(retentionDays = 7) {
  try {
    const result = await db.pool.query(`
      DELETE FROM job_lock_tracking
      WHERE acquired_at < CURRENT_TIMESTAMP - (($1) * INTERVAL '1 day')
        AND status IN ('RELEASED', 'TIMED_OUT')
      RETURNING COUNT(*) as deleted
    `, [retentionDays]);

    const deleted = result.rows[0]?.deleted || 0;
    logger.info(`Cleaned up ${deleted} old lock tracking records`);
  } catch (error) {
    logger.error("Error cleaning up lock records:", error);
  }
}

/**
 * Notify job owner of issues
 */
async function notifyJobOwner(jobName, email, metadata) {
  // TODO: Integrate with notification service
  // For now just log
  logger.warn(`JOB ALERT for ${jobName}: ${JSON.stringify(metadata)}`);
}

module.exports = {
  recordLockAcquired,
  recordLockReleased,
  detectStuckLocks,
  getLockContention,
  getLockContentionSummary,
  cleanupOldLockRecords,
  notifyJobOwner
};
