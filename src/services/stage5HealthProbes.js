/**
 * Stage 5 Health Check Probes
 *
 * Integrates health monitoring for:
 * - PR A (Schema Inventory): schema_consistency probe
 * - PR B (Job Registry): job_registry_health, job_lock_tracking probes
 * - PR C (Retry Engine): quarantine_queue, retry_policy_compliance probes
 * - PR D (Deferred Events): outbox_backlog, outbox_delivery probes
 */

const db = require("../../db");
const logger = require("../config/logger");

/**
 * Record health check result
 */
async function recordHealthCheck(componentName, probeName, status, details = {}, latencyMs = 0, severity = null) {
  try {
    const remediationSteps = getRemediationSteps(componentName, probeName, status, details);

    await db.pool.query(`
      INSERT INTO observability.health_check_results (
        service_name,
        probe_name,
        component_name,
        status,
        alert_severity,
        latency_ms,
        metadata,
        remediation_steps,
        checked_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    `, [
      "madsuite-backend",
      probeName,
      componentName,
      status,
      severity || (status === 'unhealthy' ? 'critical' : status === 'degraded' ? 'warning' : 'none'),
      latencyMs,
      JSON.stringify(details),
      remediationSteps
    ]);
  } catch (error) {
    logger.error(`Error recording health check for ${componentName}/${probeName}:`, error);
  }
}

/**
 * Schema Consistency Probe (PR A)
 * Detects breaking schema changes since last check
 */
async function probeSchemaConsistency() {
  const startTime = Date.now();
  try {
    // Get current schema inventory
    const { getSchemaInventory, validateInventory } = require("../migrate/schemaInventory");
    const inventory = await getSchemaInventory();

    // Validate inventory for consistency
    const validation = validateInventory(inventory);
    const validationIssues = Object.values(validation)
      .filter(Array.isArray)
      .flat();
    const tableCount = inventory.stats.table_count ?? inventory.stats.tableCount ?? 0;
    const columnCount = inventory.stats.column_count ?? inventory.stats.columnCount ?? 0;

    if (validationIssues.length > 0) {
      const details = {
        issues: validationIssues,
        tablesCount: tableCount,
        columnsCount: columnCount
      };

      await recordHealthCheck(
        "schema_inventory",
        "schema_consistency",
        "unhealthy",
        details,
        Date.now() - startTime,
        "critical"
      );

      return {
        status: "unhealthy",
        component: "schema_inventory",
        probe: "schema_consistency",
        message: `Schema validation failed: ${validationIssues.join(", ")}`,
        details,
        latency_ms: Date.now() - startTime
      };
    }

    // Check for breaking changes (new NOT NULL columns without defaults, dropped columns, etc.)
    const breakingChanges = detectBreakingSchemaChanges(inventory);

    if (breakingChanges.length > 0) {
      const details = {
        breaking_changes: breakingChanges,
        table_count: tableCount
      };

      await recordHealthCheck(
        "schema_inventory",
        "schema_consistency",
        "degraded",
        details,
        Date.now() - startTime,
        "warning"
      );

      return {
        status: "degraded",
        component: "schema_inventory",
        probe: "schema_consistency",
        message: `Schema has breaking changes that need review`,
        details,
        latency_ms: Date.now() - startTime
      };
    }

    await recordHealthCheck(
      "schema_inventory",
      "schema_consistency",
      "healthy",
      { table_count: tableCount, column_count: columnCount },
      Date.now() - startTime
    );

    return {
      status: "healthy",
      component: "schema_inventory",
      probe: "schema_consistency",
      details: { table_count: tableCount, column_count: columnCount },
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Schema consistency probe error:", error);

    await recordHealthCheck(
      "schema_inventory",
      "schema_consistency",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "schema_inventory",
      probe: "schema_consistency",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Job Registry Health Probe (PR B)
 * Monitor job execution status
 */
async function probeJobRegistryHealth() {
  const startTime = Date.now();
  try {
    const { getJobsHealth, registerAllJobs } = require("../config/jobRegistry");
    let jobHealth = await getJobsHealth();

    if (jobHealth.length === 0) {
      await registerAllJobs();
      jobHealth = await getJobsHealth();
    }

    const details = {
      total_jobs: jobHealth.length,
      healthy: jobHealth.filter(j => j.health_status === "HEALTHY").length,
      failed: jobHealth.filter(j => j.health_status === "FAILED").length,
      overdue: jobHealth.filter(j => j.health_status === "OVERDUE").length,
      never_run: jobHealth.filter(j => j.health_status === "NEVER_RUN").length
    };

    let status = "healthy";
    let severity = "none";

    if (details.failed > 0) {
      status = "degraded";
      severity = "warning";
    }

    if (details.overdue > 0) {
      status = "unhealthy";
      severity = "critical";
    }

    await recordHealthCheck(
      "job_registry",
      "job_registry_health",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "job_registry",
      probe: "job_registry_health",
      details,
      failed_jobs: jobHealth.filter(j => j.health_status === "FAILED").map(j => j.job_name),
      overdue_jobs: jobHealth.filter(j => j.health_status === "OVERDUE").map(j => j.job_name),
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Job registry health probe error:", error);

    await recordHealthCheck(
      "job_registry",
      "job_registry_health",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "job_registry",
      probe: "job_registry_health",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Job Lock Tracking Probe (PR B)
 * Detect stuck or deadlocked jobs
 */
async function probeJobLockTracking() {
  const startTime = Date.now();
  try {
    const { detectStuckLocks, getLockContentionSummary } = require("./jobLockTracker");

    const stuckLocks = await detectStuckLocks();
    const contention = await getLockContentionSummary();

    const details = {
      total_locks_24h: contention.reduce((sum, j) => sum + (j.total_locks_24h || 0), 0),
      currently_held: contention.reduce((sum, j) => sum + (j.currently_held || 0), 0),
      timeouts_24h: contention.reduce((sum, j) => sum + (j.timeouts_24h || 0), 0),
      stuck_locks: stuckLocks.length
    };

    let status = "healthy";
    let severity = "none";

    if (stuckLocks.length > 0) {
      status = "degraded";
      severity = "warning";
    }

    if (stuckLocks.length > 2) {
      status = "unhealthy";
      severity = "critical";
    }

    await recordHealthCheck(
      "job_registry",
      "job_lock_tracking",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "job_registry",
      probe: "job_lock_tracking",
      details,
      stuck_locks: stuckLocks.map(l => ({ job_name: l.job_name, held_seconds: l.held_seconds })),
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Job lock tracking probe error:", error);

    await recordHealthCheck(
      "job_registry",
      "job_lock_tracking",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "job_registry",
      probe: "job_lock_tracking",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Quarantine Queue Size Probe (PR C)
 * Monitor dead-letter queue for growth/aging
 */
async function probeQuarantineQueueSize() {
  const startTime = Date.now();
  try {
    const result = await db.pool.query(`
      SELECT
        COUNT(*) as total_items,
        COUNT(*) FILTER (WHERE recovery_status = 'waiting') as waiting_recovery,
        COUNT(*) FILTER (WHERE recovery_status = 'in_progress') as in_recovery,
        COUNT(*) FILTER (WHERE recovery_status = 'recovered') as recovered,
        COUNT(DISTINCT work_type) as work_types,
        MIN(created_at) as oldest_item_age,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at)))::INT as oldest_age_seconds
      FROM quarantine_queue
    `);

    const row = result.rows[0];
    const details = {
      total_items: parseInt(row.total_items),
      waiting_recovery: parseInt(row.waiting_recovery),
      in_recovery: parseInt(row.in_recovery),
      recovered: parseInt(row.recovered),
      work_types: parseInt(row.work_types),
      oldest_age_seconds: parseInt(row.oldest_age_seconds)
    };

    let status = "healthy";
    let severity = "none";

    // Check warning threshold: >50 items
    if (details.total_items > 50) {
      status = "degraded";
      severity = "warning";
    }

    // Check critical threshold: >100 items
    if (details.total_items > 100) {
      status = "unhealthy";
      severity = "critical";
    }

    // Check age: items older than 7 days
    if (details.oldest_age_seconds > 604800) {
      if (status !== "unhealthy") {
        status = "degraded";
        severity = "warning";
      }
    }

    await recordHealthCheck(
      "retry_engine",
      "quarantine_queue_size",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "retry_engine",
      probe: "quarantine_queue_size",
      details,
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Quarantine queue size probe error:", error);

    await recordHealthCheck(
      "retry_engine",
      "quarantine_queue_size",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "retry_engine",
      probe: "quarantine_queue_size",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Retry Policy Compliance Probe (PR C)
 * Validate retry policy configuration
 */
async function probeRetryPolicyCompliance() {
  const startTime = Date.now();
  try {
    const result = await db.pool.query(`
      SELECT
        COUNT(*) as total_policies,
        COUNT(*) FILTER (WHERE backoff_strategy IS NULL OR backoff_strategy = '') as missing_strategy,
        COUNT(*) FILTER (WHERE max_attempts IS NULL OR max_attempts < 1) as invalid_attempts,
        COUNT(*) FILTER (WHERE initial_backoff_seconds IS NULL OR initial_backoff_seconds < 1) as missing_backoff
      FROM retry_policies
    `);

    const row = result.rows[0];
    const details = {
      total_policies: parseInt(row.total_policies),
      missing_strategy: parseInt(row.missing_strategy),
      invalid_attempts: parseInt(row.invalid_attempts),
      missing_backoff: parseInt(row.missing_backoff)
    };

    const issueCount = details.missing_strategy + details.invalid_attempts + details.missing_backoff;

    let status = "healthy";
    let severity = "none";

    if (issueCount > 0) {
      status = "degraded";
      severity = "warning";
    }

    await recordHealthCheck(
      "retry_engine",
      "retry_policy_compliance",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "retry_engine",
      probe: "retry_policy_compliance",
      details,
      issues: issueCount,
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Retry policy compliance probe error:", error);

    await recordHealthCheck(
      "retry_engine",
      "retry_policy_compliance",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "retry_engine",
      probe: "retry_policy_compliance",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Outbox Pending Events Probe (PR D)
 * Monitor event queue backlog
 */
async function probeOutboxPendingEvents() {
  const startTime = Date.now();
  try {
    const result = await db.pool.query(`
      SELECT
        COUNT(*) as total_pending,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'quarantined') as quarantined,
        COUNT(DISTINCT event_handler_name) as handler_types,
        MAX(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)))::INT as oldest_event_seconds
      FROM outbox_events
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `);

    const row = result.rows[0];
    const details = {
      total_pending: parseInt(row.total_pending),
      pending: parseInt(row.pending),
      processing: parseInt(row.processing),
      failed: parseInt(row.failed),
      quarantined: parseInt(row.quarantined),
      handler_types: parseInt(row.handler_types),
      oldest_event_seconds: parseInt(row.oldest_event_seconds)
    };

    let status = "healthy";
    let severity = "none";

    // Warning: >500 pending events
    if (details.pending > 500) {
      status = "degraded";
      severity = "warning";
    }

    // Critical: >1000 pending events
    if (details.pending > 1000) {
      status = "unhealthy";
      severity = "critical";
    }

    // Warning: events stuck in processing >1 hour
    if (details.processing > 10) {
      if (status !== "unhealthy") {
        status = "degraded";
        severity = "warning";
      }
    }

    await recordHealthCheck(
      "outbox_processor",
      "outbox_pending_events",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "outbox_processor",
      probe: "outbox_pending_events",
      details,
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Outbox pending events probe error:", error);

    await recordHealthCheck(
      "outbox_processor",
      "outbox_pending_events",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "outbox_processor",
      probe: "outbox_pending_events",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Outbox Delivery Latency Probe (PR D)
 * Monitor event delivery performance
 */
async function probeOutboxDeliveryLatency() {
  const startTime = Date.now();
  try {
    const result = await db.pool.query(`
      SELECT
        event_handler_name,
        SUM(total_events) as total_delivered,
        AVG(avg_delivery_time_ms)::INT as avg_latency_ms,
        MAX(max_delivery_time_ms) as max_latency_ms,
        SUM(successfully_delivered) as successful,
        SUM(failed_permanently) as failed
      FROM outbox_delivery_stats
      WHERE date >= CURRENT_DATE - INTERVAL '1 day'
      GROUP BY event_handler_name
    `);

    const stats = result.rows;
    const details = {
      total_handlers: stats.length,
      overall_avg_latency_ms: Math.round(
        stats.reduce((sum, s) => sum + (s.avg_latency_ms || 0), 0) / Math.max(stats.length, 1)
      ),
      successful_deliveries: stats.reduce((sum, s) => sum + (parseInt(s.successful) || 0), 0),
      failed_deliveries: stats.reduce((sum, s) => sum + (parseInt(s.failed) || 0), 0),
      handlers: stats.map(s => ({
        name: s.event_handler_name,
        avg_latency_ms: s.avg_latency_ms,
        max_latency_ms: s.max_latency_ms
      }))
    };

    let status = "healthy";
    let severity = "none";

    // Warning: avg latency >10s
    if (details.overall_avg_latency_ms > 10000) {
      status = "degraded";
      severity = "warning";
    }

    // Critical: avg latency >30s
    if (details.overall_avg_latency_ms > 30000) {
      status = "unhealthy";
      severity = "critical";
    }

    // Check individual handlers
    const slowHandlers = stats.filter(s => s.avg_latency_ms > 15000);
    if (slowHandlers.length > 0 && status === "healthy") {
      status = "degraded";
      severity = "warning";
    }

    await recordHealthCheck(
      "outbox_processor",
      "outbox_delivery_latency",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "outbox_processor",
      probe: "outbox_delivery_latency",
      details,
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Outbox delivery latency probe error:", error);

    await recordHealthCheck(
      "outbox_processor",
      "outbox_delivery_latency",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "outbox_processor",
      probe: "outbox_delivery_latency",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Recovery Operations Probe (PR C)
 * Monitor quarantine recovery success rate
 */
async function probeRecoveryOperations() {
  const startTime = Date.now();
  try {
    const result = await db.pool.query(`
      SELECT
        COUNT(*) as total_operations,
        COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'succeeded') / NULLIF(COUNT(*), 0))::INT as success_rate
      FROM recovery_operations
      WHERE initiated_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `);

    const row = result.rows[0];
    const details = {
      total_operations: parseInt(row.total_operations),
      succeeded: parseInt(row.succeeded),
      failed: parseInt(row.failed),
      pending: parseInt(row.pending),
      success_rate: parseInt(row.success_rate)
    };

    let status = "healthy";
    let severity = "none";

    // Warning: <80% success rate
    if (details.success_rate < 80 && details.total_operations > 0) {
      status = "degraded";
      severity = "warning";
    }

    // Critical: <50% success rate
    if (details.success_rate < 50 && details.total_operations > 0) {
      status = "unhealthy";
      severity = "critical";
    }

    await recordHealthCheck(
      "retry_engine",
      "recovery_operations",
      status,
      details,
      Date.now() - startTime,
      severity
    );

    return {
      status,
      component: "retry_engine",
      probe: "recovery_operations",
      details,
      latency_ms: Date.now() - startTime
    };
  } catch (error) {
    logger.error("Recovery operations probe error:", error);

    await recordHealthCheck(
      "retry_engine",
      "recovery_operations",
      "unhealthy",
      { error: error.message },
      Date.now() - startTime,
      "critical"
    );

    return {
      status: "unhealthy",
      component: "retry_engine",
      probe: "recovery_operations",
      error: error.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Helper: Detect breaking schema changes
 */
function detectBreakingSchemaChanges(inventory) {
  const changes = [];
  const tables = Array.isArray(inventory.tables)
    ? inventory.tables
    : Object.values(inventory.tables || {});

  // Check for NOT NULL columns without defaults (would prevent inserts)
  for (const table of tables) {
    for (const column of table.columns || []) {
      const isNullable = column.is_nullable ?? column.nullable;
      const columnDefault = column.column_default ?? column.default;
      const tableName = table.table_name ?? table.name;
      const columnName = column.column_name ?? column.name;

      if (isNullable === false && !columnDefault) {
        changes.push(`Table ${tableName}: Column ${columnName} is NOT NULL without default`);
      }
    }
  }

  return changes;
}

/**
 * Helper: Get remediation steps for failed probes
 */
function getRemediationSteps(componentName, probeName, status, details) {
  if (status === "healthy") {
    return null;
  }

  const remediationMap = {
    schema_consistency: "Run schema inventory check: npm run verify:schema-inventory. Review schema changes for breaking compatibility.",
    job_registry_health: "Check failed jobs in job_registry table. Review job logs for execution errors. Restart failing jobs with updateJobStatus().",
    job_lock_tracking: "Detect stuck locks via jobLockTracker.detectStuckLocks(). Investigate job execution timeout and lock configuration.",
    quarantine_queue_size: "Query quarantine_queue table. Initiate manual recovery via initiateRecovery() for important items. Review error patterns.",
    retry_policy_compliance: "Validate all retry_policies rows have required fields: backoff_strategy, initial_backoff_seconds, max_attempts.",
    outbox_pending_events: "Check outbox_events.status='pending'. Review handler logs for delivery failures. Trigger manual retry or recovery.",
    outbox_delivery_latency: "Review outbox_delivery_stats for slow handlers. Check handler implementation and external service latency.",
    recovery_operations: "Analyze recovery_operations failures. Review quarantine items and fix underlying issues before recovery retry."
  };

  return remediationMap[probeName] || "Review component logs for additional details.";
}

/**
 * Run all Stage 5 health probes
 */
async function runAllStage5Probes() {
  const results = [];

  try {
    results.push(await probeSchemaConsistency());
  } catch (error) {
    logger.error("Error running schema consistency probe:", error);
  }

  try {
    results.push(await probeJobRegistryHealth());
  } catch (error) {
    logger.error("Error running job registry health probe:", error);
  }

  try {
    results.push(await probeJobLockTracking());
  } catch (error) {
    logger.error("Error running job lock tracking probe:", error);
  }

  try {
    results.push(await probeQuarantineQueueSize());
  } catch (error) {
    logger.error("Error running quarantine queue probe:", error);
  }

  try {
    results.push(await probeRetryPolicyCompliance());
  } catch (error) {
    logger.error("Error running retry policy compliance probe:", error);
  }

  try {
    results.push(await probeOutboxPendingEvents());
  } catch (error) {
    logger.error("Error running outbox pending events probe:", error);
  }

  try {
    results.push(await probeOutboxDeliveryLatency());
  } catch (error) {
    logger.error("Error running outbox delivery latency probe:", error);
  }

  try {
    results.push(await probeRecoveryOperations());
  } catch (error) {
    logger.error("Error running recovery operations probe:", error);
  }

  return results;
}

/**
 * Get overall system health
 */
async function getOverallSystemHealth() {
  const probes = await runAllStage5Probes();

  let overallStatus = "healthy";
  if (probes.some(p => p.status === "unhealthy")) {
    overallStatus = "unhealthy";
  } else if (probes.some(p => p.status === "degraded")) {
    overallStatus = "degraded";
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    probes,
    summary: {
      healthy: probes.filter(p => p.status === "healthy").length,
      degraded: probes.filter(p => p.status === "degraded").length,
      unhealthy: probes.filter(p => p.status === "unhealthy").length
    }
  };
}

module.exports = {
  probeSchemaConsistency,
  probeJobRegistryHealth,
  probeJobLockTracking,
  probeQuarantineQueueSize,
  probeRetryPolicyCompliance,
  probeOutboxPendingEvents,
  probeOutboxDeliveryLatency,
  probeRecoveryOperations,
  runAllStage5Probes,
  getOverallSystemHealth,
  recordHealthCheck
};
