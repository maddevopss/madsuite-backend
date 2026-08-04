/**
 * Retry Engine
 *
 * Generalized retry and backoff management with quarantine support:
 * - Configurable backoff strategies (exponential, linear, fixed)
 * - Automatic quarantine for permanently failed items
 * - Manual recovery with audit trail
 * - Integration with retry policies
 */

const db = require("../../db");
const logger = require("../config/logger");

/**
 * Calculate next retry delay based on strategy
 */
function calculateBackoffDelay(strategy, initialBackoff, multiplier, attemptNumber) {
  switch (strategy) {
    case "exponential":
      return Math.min(
        initialBackoff * Math.pow(multiplier, attemptNumber - 1),
        initialBackoff * Math.pow(multiplier, 10)  // Cap exponential growth
      );

    case "linear":
      return initialBackoff + (initialBackoff * multiplier * (attemptNumber - 1));

    case "fixed":
      return initialBackoff;

    default:
      return initialBackoff;
  }
}

/**
 * Record a retry attempt
 */
async function recordRetryAttempt(workType, workId, config) {
  const {
    attemptNumber = 1,
    status = "pending",
    errorClassification = null,
    errorMessage = null,
    errorCode = null,
    backoffStrategy = "exponential",
    backoffMultiplier = 1.5,
    metadata = {}
  } = config;

  const backoffSeconds = attemptNumber > 1
    ? calculateBackoffDelay(backoffStrategy, 60, backoffMultiplier, attemptNumber)
    : 0;

  const attemptAt = new Date();
  if (backoffSeconds > 0) {
    attemptAt.setSeconds(attemptAt.getSeconds() + backoffSeconds);
  }

  try {
    const result = await db.pool.query(`
      INSERT INTO retry_attempts (
        work_type, work_id, attempt_number,
        attempt_at, status, error_classification,
        error_message, error_code,
        backoff_strategy, backoff_multiplier, backoff_seconds,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, attempt_at, backoff_seconds
    `, [
      workType, workId, attemptNumber,
      attemptAt, status, errorClassification,
      errorMessage, errorCode,
      backoffStrategy, backoffMultiplier, Math.floor(backoffSeconds),
      JSON.stringify(metadata)
    ]);

    return result.rows[0];
  } catch (error) {
    logger.error(`Error recording retry attempt for ${workType}:${workId}:`, error);
    throw error;
  }
}

/**
 * Classify error as transient or permanent
 */
function classifyError(error, errorCode, retryPolicy = null) {
  // Check against permanent error codes if policy provided
  if (retryPolicy?.permanent_error_codes?.includes(errorCode)) {
    return {
      classification: "permanent",
      errorClassification: "validation"
    };
  }

  // Heuristics for transient vs permanent
  const message = (error.message || "").toLowerCase();
  const code = String(errorCode || "");

  // Network/transient errors
  if (code.match(/^(50[0-9]|429|408)$/) ||
      message.match(/timeout|econnrefused|enotfound|network/i)) {
    return {
      classification: "transient",
      errorClassification: code === "429" ? "rate_limit" : "network"
    };
  }

  // Permanent client errors
  if (code.match(/^(40[0-4]|422)$/)) {
    return {
      classification: "permanent",
      errorClassification: "validation"
    };
  }

  // Unknown - treat as transient
  return {
    classification: "transient",
    errorClassification: "unknown"
  };
}

/**
 * Handle retry or quarantine based on attempt count and error type
 */
async function handleRetryOrQuarantine(workType, workId, config) {
  const {
    attemptNumber = 1,
    maxAttempts = 3,
    error,
    errorCode,
    errorMessage,
    payload,
    retryPolicy
  } = config;

  const { classification, errorClassification } = classifyError(error, errorCode, retryPolicy);

  // Record the attempt
  await recordRetryAttempt(workType, workId, {
    attemptNumber,
    status: "failed_" + classification,
    errorClassification,
    errorMessage,
    errorCode,
    backoffStrategy: retryPolicy?.backoff_strategy || "exponential",
    backoffMultiplier: retryPolicy?.backoff_multiplier || 1.5,
    metadata: config.metadata || {}
  });

  // Determine if we should quarantine
  const shouldQuarantine = classification === "permanent" || attemptNumber >= maxAttempts;

  if (shouldQuarantine && classification === "permanent") {
    await quarantineWork(workType, workId, {
      reason: "permanent_error",
      errorCode,
      errorMessage,
      payload,
      tags: config.tags || []
    });

    return {
      action: "quarantine",
      reason: "permanent_error",
      message: `Permanently failed: ${errorMessage}`
    };
  }

  if (attemptNumber >= maxAttempts) {
    await quarantineWork(workType, workId, {
      reason: "max_retries_exceeded",
      errorCode,
      errorMessage,
      payload,
      tags: config.tags || []
    });

    return {
      action: "quarantine",
      reason: "max_retries_exceeded",
      message: `Max retries (${maxAttempts}) exceeded`
    };
  }

  // Will retry
  return {
    action: "retry",
    nextAttempt: attemptNumber + 1,
    message: `Scheduling retry ${attemptNumber + 1} (transient error)`
  };
}

/**
 * Quarantine a work item
 */
async function quarantineWork(workType, workId, config) {
  const {
    reason = "max_retries_exceeded",
    errorCode,
    errorMessage,
    payload,
    tags = [],
    firstAttemptAt = new Date(),
    totalAttempts = 1
  } = config;

  try {
    const result = await db.pool.query(`
      INSERT INTO quarantine_queue (
        work_type, work_id, reason,
        permanent_error_code, permanent_error_message,
        total_attempts, first_attempt_at, last_attempt_at,
        payload, tags, recovery_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'waiting')
      ON CONFLICT (work_type, work_id) DO UPDATE SET
        reason = EXCLUDED.reason,
        permanent_error_message = EXCLUDED.permanent_error_message,
        last_attempt_at = CURRENT_TIMESTAMP,
        payload = EXCLUDED.payload,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [
      workType, workId, reason,
      errorCode, errorMessage,
      totalAttempts, firstAttemptAt, new Date(),
      JSON.stringify(payload), tags
    ]);

    logger.warn(`Quarantined ${workType}:${workId}: ${reason}`);
    return result.rows[0];
  } catch (error) {
    logger.error(`Error quarantining work ${workType}:${workId}:`, error);
    throw error;
  }
}

/**
 * Get quarantine item by work type and ID
 */
async function getQuarantineItem(workType, workId) {
  const result = await db.pool.query(`
    SELECT *
    FROM quarantine_queue
    WHERE work_type = $1 AND work_id = $2
  `, [workType, workId]);

  return result.rows[0] || null;
}

/**
 * Get all quarantined items for a work type
 */
async function getQuarantineQueue(workType, filters = {}) {
  let query = `SELECT * FROM quarantine_queue WHERE work_type = $1`;
  const params = [workType];
  let paramCount = 2;

  if (filters.reason) {
    query += ` AND reason = $${paramCount}`;
    params.push(filters.reason);
    paramCount++;
  }

  if (filters.recoveryStatus) {
    query += ` AND recovery_status = $${paramCount}`;
    params.push(filters.recoveryStatus);
    paramCount++;
  }

  if (filters.tag) {
    query += ` AND $${paramCount} = ANY(tags)`;
    params.push(filters.tag);
    paramCount++;
  }

  query += ` ORDER BY created_at DESC`;

  if (filters.limit) {
    query += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
  }

  const result = await db.pool.query(query, params);
  return result.rows;
}

/**
 * Initiate manual recovery of a quarantined item
 */
async function initiateRecovery(quarantineId, config) {
  const {
    operationType = "manual_retry",
    initiatedBy = "system",
    payloadOverride = null
  } = config;

  try {
    // Get quarantine item
    const quarantine = await db.pool.query(`
      SELECT work_type, work_id, payload
      FROM quarantine_queue
      WHERE id = $1
    `, [quarantineId]);

    if (!quarantine.rows.length) {
      throw new Error(`Quarantine item ${quarantineId} not found`);
    }

    const { work_type, work_id, payload } = quarantine.rows[0];

    // Create recovery operation
    const result = await db.pool.query(`
      INSERT INTO recovery_operations (
        quarantine_id, work_type, work_id,
        operation_type, initiated_by, payload_override
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, initiated_at
    `, [
      quarantineId, work_type, work_id,
      operationType, initiatedBy,
      payloadOverride ? JSON.stringify(payloadOverride) : null
    ]);

    // Update quarantine status
    await db.pool.query(`
      UPDATE quarantine_queue
      SET recovery_status = 'in_progress',
          recovery_attempts = recovery_attempts + 1,
          last_recovery_attempt_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [quarantineId]);

    logger.info(`Recovery initiated for ${work_type}:${work_id}`);
    return result.rows[0];
  } catch (error) {
    logger.error(`Error initiating recovery for quarantine ${quarantineId}:`, error);
    throw error;
  }
}

/**
 * Mark recovery operation as succeeded
 */
async function markRecoverySucceeded(recoveryId, message = null) {
  try {
    const result = await db.pool.query(`
      UPDATE recovery_operations
      SET status = 'succeeded',
          result_message = $2,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING quarantine_id
    `, [recoveryId, message]);

    if (result.rows.length > 0) {
      // Update quarantine status
      await db.pool.query(`
        UPDATE quarantine_queue
        SET recovery_status = 'recovered'
        WHERE id = $1
      `, [result.rows[0].quarantine_id]);

      logger.info(`Recovery succeeded for operation ${recoveryId}`);
    }
  } catch (error) {
    logger.error(`Error marking recovery as succeeded:`, error);
    throw error;
  }
}

/**
 * Mark recovery operation as failed
 */
async function markRecoveryFailed(recoveryId, errorMessage) {
  try {
    await db.pool.query(`
      UPDATE recovery_operations
      SET status = 'failed',
          result_message = $2,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [recoveryId, errorMessage]);

    logger.warn(`Recovery failed for operation ${recoveryId}: ${errorMessage}`);
  } catch (error) {
    logger.error(`Error marking recovery as failed:`, error);
    throw error;
  }
}

/**
 * Get retry policy by name
 */
async function getRetryPolicy(policyName) {
  const result = await db.pool.query(`
    SELECT *
    FROM retry_policies
    WHERE policy_name = $1
  `, [policyName]);

  return result.rows[0] || null;
}

/**
 * Get all retry policies
 */
async function getAllRetryPolicies() {
  const result = await db.pool.query(`
    SELECT *
    FROM retry_policies
    ORDER BY policy_name
  `);

  return result.rows;
}

/**
 * Get retry statistics for work type
 */
async function getRetryStats(workType) {
  const result = await db.pool.query(`
    SELECT
      work_type,
      status,
      error_classification,
      COUNT(*) as count,
      AVG(duration_ms) as avg_duration_ms
    FROM retry_attempts
    WHERE work_type = $1
      AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
    GROUP BY work_type, status, error_classification
    ORDER BY count DESC
  `, [workType]);

  return result.rows;
}

/**
 * Get quarantine statistics
 */
async function getQuarantineStats() {
  const result = await db.pool.query(`
    SELECT
      work_type,
      reason,
      recovery_status,
      COUNT(*) as count,
      AVG(recovery_attempts) as avg_recovery_attempts,
      MIN(created_at) as oldest_item
    FROM quarantine_queue
    GROUP BY work_type, reason, recovery_status
    ORDER BY count DESC
  `);

  return result.rows;
}

/**
 * Cleanup old retry attempts (retention-based)
 */
async function cleanupRetryAttempts(retentionDays = 30) {
  try {
    const result = await db.pool.query(`
      WITH deleted AS (
        DELETE FROM retry_attempts
        WHERE attempt_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
          AND status IN ('success', 'failed_permanent')
        RETURNING id
      )
      SELECT COUNT(*)::INT as deleted FROM deleted
    `, [retentionDays]);

    const deleted = result.rows[0]?.deleted || 0;
    logger.info(`Cleaned up ${deleted} old retry attempts`);
  } catch (error) {
    logger.error("Error cleaning up retry attempts:", error);
  }
}

module.exports = {
  calculateBackoffDelay,
  recordRetryAttempt,
  classifyError,
  handleRetryOrQuarantine,
  quarantineWork,
  getQuarantineItem,
  getQuarantineQueue,
  initiateRecovery,
  markRecoverySucceeded,
  markRecoveryFailed,
  getRetryPolicy,
  getAllRetryPolicies,
  getRetryStats,
  getQuarantineStats,
  cleanupRetryAttempts
};
