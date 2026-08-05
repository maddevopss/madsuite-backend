/**
 * Issue #173 PR F: Structured Operation Logger
 *
 * Records operational activities to operation_logs table for:
 * - Audit trail (who did what and when)
 * - Debugging (detailed error context)
 * - Compliance (all state changes tracked)
 * - Monitoring (operation latency and error rates)
 */

const db = require("../../db");

/**
 * Log a completed operation
 * @param {string} operationType - 'schema_change', 'job_execution', 'retry_attempt', 'event_delivery', etc.
 * @param {string} componentName - 'schema_inventory', 'job_registry', 'retry_engine', 'outbox_processor'
 * @param {object} config - {userId?, action?, resourceType?, resourceId?, status, message?, details?, durationMs?, severity?}
 */
async function logOperation(operationType, componentName, config) {
  const {
    userId = null,
    action = 'EXECUTE',
    resourceType = null,
    resourceId = null,
    status = 'success',
    message = null,
    details = null,
    durationMs = 0,
    severity = 'info',
    startedAt = null
  } = config;

  const query = `
    INSERT INTO operation_logs (
      operation_type,
      component_name,
      resource_type,
      resource_id,
      user_id,
      action,
      status,
      message,
      details,
      duration_ms,
      severity,
      created_at,
      started_at,
      completed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, $12, CURRENT_TIMESTAMP
    )
    RETURNING id;
  `;

  try {
    const result = await db.pool.query(query, [
      operationType,
      componentName,
      resourceType,
      resourceId,
      userId,
      action,
      status,
      message,
      details ? JSON.stringify(details) : null,
      durationMs,
      severity,
      startedAt
    ]);

    return {
      id: result.rows[0].id,
      logged: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error logging operation ${operationType}/${componentName}:`, error);
    return {
      logged: false,
      error: error.message
    };
  }
}

/**
 * Log a schema change operation
 */
async function logSchemaChange(config) {
  const {
    userId = null,
    action = 'schema_change',
    resourceType = 'schema',
    resourceId = null,
    message = null,
    details = {},
    durationMs = 0,
    status = 'success'
  } = config;

  return logOperation('schema_change', 'schema_inventory', {
    userId,
    action,
    resourceType,
    resourceId,
    status,
    message,
    details,
    durationMs,
    severity: status === 'success' ? 'info' : 'warning'
  });
}

/**
 * Log a job execution
 */
async function logJobExecution(jobName, config) {
  const {
    userId = null,
    status = 'success',
    message = null,
    details = {},
    durationMs = 0,
    error = null,
    startedAt = null
  } = config;

  const operationDetails = {
    job_name: jobName,
    ...details
  };

  if (error) {
    operationDetails.error = error;
  }

  return logOperation('job_execution', 'job_registry', {
    userId,
    action: 'EXECUTE',
    resourceType: 'job',
    resourceId: jobName,
    status,
    message: message || `Job ${jobName} execution ${status}`,
    details: operationDetails,
    durationMs,
    severity: status === 'success' ? 'info' : status === 'failure' ? 'error' : 'warning',
    startedAt
  });
}

/**
 * Log a retry attempt
 */
async function logRetryAttempt(workType, workId, config) {
  const {
    userId = null,
    attemptNumber = 1,
    status = 'pending',
    errorCode = null,
    errorMessage = null,
    backoffStrategy = 'exponential',
    nextAttemptSeconds = null,
    durationMs = 0,
    startedAt = null
  } = config;

  const operationDetails = {
    work_type: workType,
    work_id: workId,
    attempt_number: attemptNumber,
    backoff_strategy: backoffStrategy
  };

  if (nextAttemptSeconds) {
    operationDetails.next_attempt_seconds = nextAttemptSeconds;
  }

  if (errorCode) {
    operationDetails.error_code = errorCode;
  }

  const severity =
    status === 'success' ? 'info' :
    status === 'failed_transient' ? 'warning' :
    'error';

  return logOperation('retry_attempt', 'retry_engine', {
    userId,
    action: 'RETRY',
    resourceType: 'work',
    resourceId: `${workType}:${workId}`,
    status,
    message: `Attempt ${attemptNumber}: ${status}${errorCode ? ` (${errorCode})` : ''}`,
    details: operationDetails,
    durationMs,
    severity,
    startedAt
  });
}

/**
 * Log a quarantine operation
 */
async function logQuarantine(workType, workId, reason, config) {
  const {
    userId = null,
    errorCode = null,
    errorMessage = null,
    totalAttempts = 0,
    payload = null,
    tags = [],
    durationMs = 0
  } = config;

  const operationDetails = {
    work_type: workType,
    work_id: workId,
    reason,
    total_attempts: totalAttempts,
    tags
  };

  if (errorCode) {
    operationDetails.error_code = errorCode;
  }

  if (payload) {
    operationDetails.payload_size_bytes = JSON.stringify(payload).length;
  }

  return logOperation('quarantine', 'retry_engine', {
    userId,
    action: 'QUARANTINE',
    resourceType: 'work',
    resourceId: `${workType}:${workId}`,
    status: 'warning',
    message: `Quarantined: ${reason}${errorCode ? ` (${errorCode})` : ''}`,
    details: operationDetails,
    durationMs,
    severity: 'warning'
  });
}

/**
 * Log a recovery operation
 */
async function logRecovery(quarantineId, config) {
  const {
    userId = 'system',
    operationType = 'manual_retry',
    workType = null,
    workId = null,
    status = 'initiated',
    message = null,
    durationMs = 0,
    resultMessage = null
  } = config;

  const operationDetails = {
    quarantine_id: quarantineId,
    operation_type: operationType
  };

  if (workType && workId) {
    operationDetails.work_type = workType;
    operationDetails.work_id = workId;
  }

  if (resultMessage) {
    operationDetails.result = resultMessage;
  }

  return logOperation('recovery', 'retry_engine', {
    userId,
    action: 'RECOVER',
    resourceType: 'quarantine_item',
    resourceId: quarantineId,
    status,
    message: message || `Recovery ${operationType} ${status}`,
    details: operationDetails,
    durationMs,
    severity: status === 'succeeded' ? 'info' : status === 'failed' ? 'error' : 'warning'
  });
}

/**
 * Log event delivery
 */
async function logEventDelivery(eventId, handlerName, config) {
  const {
    userId = null,
    status = 'success',
    message = null,
    durationMs = 0,
    errorCode = null,
    errorMessage = null,
    attemptNumber = 1,
    retryScheduled = null,
    quarantined = false
  } = config;

  const operationDetails = {
    event_id: eventId,
    handler_name: handlerName,
    attempt_number: attemptNumber
  };

  if (retryScheduled) {
    operationDetails.retry_scheduled = retryScheduled;
  }

  if (quarantined) {
    operationDetails.quarantined = true;
  }

  const severity =
    status === 'success' ? 'info' :
    status === 'failed' && quarantined ? 'error' :
    'warning';

  return logOperation('event_delivery', 'outbox_processor', {
    userId,
    action: 'DELIVER',
    resourceType: 'event',
    resourceId: eventId,
    status,
    message: message || `Event delivery ${status}`,
    details: operationDetails,
    durationMs,
    severity
  });
}

/**
 * Log a health check result
 */
async function logHealthCheck(componentName, probeName, config) {
  const {
    userId = 'system',
    status = 'healthy',
    message = null,
    details = {},
    durationMs = 0,
    alertSeverity = 'none'
  } = config;

  const operationDetails = {
    component_name: componentName,
    probe_name: probeName,
    alert_severity: alertSeverity,
    ...details
  };

  const severity = alertSeverity === 'critical' ? 'critical' : alertSeverity === 'warning' ? 'warning' : 'info';

  return logOperation('health_check', 'health_probes', {
    userId,
    action: 'CHECK',
    resourceType: 'probe',
    resourceId: `${componentName}/${probeName}`,
    status,
    message: message || `Health check: ${componentName}/${probeName} ${status}`,
    details: operationDetails,
    durationMs,
    severity
  });
}

/**
 * Query operation logs with filters
 */
async function queryOperationLogs(config) {
  const {
    operationType = null,
    componentName = null,
    status = null,
    severity = null,
    userId = null,
    daysBack = 7,
    limit = 100
  } = config;

  let query = `
    SELECT *
    FROM operation_logs
    WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${daysBack} days'
  `;

  const params = [];
  let paramIndex = 1;

  if (operationType) {
    query += ` AND operation_type = $${paramIndex++}`;
    params.push(operationType);
  }

  if (componentName) {
    query += ` AND component_name = $${paramIndex++}`;
    params.push(componentName);
  }

  if (status) {
    query += ` AND status = $${paramIndex++}`;
    params.push(status);
  }

  if (severity) {
    query += ` AND severity = $${paramIndex++}`;
    params.push(severity);
  }

  if (userId) {
    query += ` AND user_id = $${paramIndex++}`;
    params.push(userId);
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  try {
    const result = await db.pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error("Error querying operation logs:", error);
    return [];
  }
}

/**
 * Get operation summary by component
 */
async function getComponentSummary(componentName, daysBack = 7) {
  const query = `
    SELECT
      component_name,
      operation_type,
      status,
      COUNT(*) as count,
      AVG(duration_ms) as avg_duration_ms,
      MAX(duration_ms) as max_duration_ms,
      COUNT(CASE WHEN severity IN ('error', 'critical') THEN 1 END) as error_count
    FROM operation_logs
    WHERE component_name = $1
      AND created_at >= CURRENT_TIMESTAMP - INTERVAL '${daysBack} days'
    GROUP BY component_name, operation_type, status
    ORDER BY count DESC;
  `;

  try {
    const result = await db.pool.query(query, [componentName]);
    return result.rows;
  } catch (error) {
    console.error("Error getting component summary:", error);
    return [];
  }
}

/**
 * Get error trend analysis
 */
async function getErrorTrends(daysBack = 7) {
  const query = `
    SELECT
      DATE(created_at) as date,
      component_name,
      COUNT(*) as error_count,
      array_agg(DISTINCT operation_type) as operation_types,
      array_agg(DISTINCT severity) FILTER (WHERE severity IN ('error', 'critical')) as error_severities
    FROM operation_logs
    WHERE severity IN ('error', 'critical')
      AND created_at >= CURRENT_TIMESTAMP - INTERVAL '${daysBack} days'
    GROUP BY DATE(created_at), component_name
    ORDER BY date DESC, error_count DESC;
  `;

  try {
    const result = await db.pool.query(query);
    return result.rows;
  } catch (error) {
    console.error("Error getting error trends:", error);
    return [];
  }
}

/**
 * Get critical operations log (errors and critical alerts)
 */
async function getCriticalOperations(hoursBack = 24) {
  const query = `
    SELECT
      id,
      created_at,
      operation_type,
      component_name,
      resource_type,
      resource_id,
      status,
      message,
      severity,
      duration_ms
    FROM operation_logs
    WHERE severity IN ('error', 'critical')
      AND created_at >= CURRENT_TIMESTAMP - INTERVAL '${hoursBack} hours'
    ORDER BY created_at DESC
    LIMIT 1000;
  `;

  try {
    const result = await db.pool.query(query);
    return result.rows;
  } catch (error) {
    console.error("Error getting critical operations:", error);
    return [];
  }
}

/**
 * Cleanup old operation logs (retention policy)
 */
async function cleanupOldLogs(retentionDays = 90) {
  const query = `
    DELETE FROM operation_logs
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${retentionDays} days'
    RETURNING id;
  `;

  try {
    const result = await db.pool.query(query);
    return {
      deleted: result.rowCount,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error cleaning up operation logs:", error);
    return {
      deleted: 0,
      error: error.message
    };
  }
}

module.exports = {
  logOperation,
  logSchemaChange,
  logJobExecution,
  logRetryAttempt,
  logQuarantine,
  logRecovery,
  logEventDelivery,
  logHealthCheck,
  queryOperationLogs,
  getComponentSummary,
  getErrorTrends,
  getCriticalOperations,
  cleanupOldLogs
};
