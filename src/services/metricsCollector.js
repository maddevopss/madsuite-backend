/**
 * Issue #173 PR F: Stage 5 Metrics Collection Service
 *
 * Collects and aggregates metrics from all Stage 5 components:
 * - Retry attempts → retry_metrics (hourly aggregation)
 * - Quarantine queue → quarantine_metrics (hourly aging analysis)
 * - Event delivery → event_delivery_metrics (by handler)
 * - Job execution → job_execution_metrics (by job)
 * - Schema changes → schema_change_metrics (daily)
 *
 * Called hourly by a scheduled job to maintain time-series data.
 */

const db = require("../../db");

/**
 * Collect retry metrics for the current hour
 * Aggregates retry_attempts grouped by date/hour
 */
async function collectRetryMetrics() {
  const query = `
    INSERT INTO retry_metrics (
      date, hour, total_attempts, successful, failed_transient, failed_permanent, quarantined,
      exponential_count, linear_count, fixed_count,
      avg_backoff_seconds, min_backoff_seconds, max_backoff_seconds,
      error_breakdown, top_error, top_error_count
    )
    SELECT
      CURRENT_DATE as date,
      EXTRACT(HOUR FROM attempt_at)::INT as hour,
      COUNT(*) as total_attempts,
      COUNT(*) FILTER (WHERE status = 'success') as successful,
      COUNT(*) FILTER (WHERE status = 'failed_transient') as failed_transient,
      COUNT(*) FILTER (WHERE status = 'failed_permanent') as failed_permanent,
      COUNT(*) FILTER (WHERE status = 'failed_permanent' AND error_classification = 'permanent') as quarantined,
      COUNT(*) FILTER (WHERE backoff_strategy = 'exponential') as exponential_count,
      COUNT(*) FILTER (WHERE backoff_strategy = 'linear') as linear_count,
      COUNT(*) FILTER (WHERE backoff_strategy = 'fixed') as fixed_count,
      AVG(backoff_seconds) as avg_backoff_seconds,
      MIN(backoff_seconds) as min_backoff_seconds,
      MAX(backoff_seconds) as max_backoff_seconds,
      jsonb_object_agg(error_classification, error_count) FILTER (WHERE error_classification IS NOT NULL) as error_breakdown,
      (array_agg(error_code ORDER BY error_code_count DESC))[1] as top_error,
      (array_agg(error_code_count ORDER BY error_code_count DESC))[1] as top_error_count
    FROM (
      SELECT
        attempt_at,
        status,
        error_classification,
        backoff_strategy,
        backoff_seconds,
        error_code,
        COUNT(*) as error_code_count,
        COUNT(*) as error_count
      FROM retry_attempts
      WHERE DATE(attempt_at) = CURRENT_DATE
        AND EXTRACT(HOUR FROM attempt_at)::INT = EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT
      GROUP BY attempt_at, status, error_classification, backoff_strategy, backoff_seconds, error_code
    ) subquery
    GROUP BY date, hour
    ON CONFLICT (date, hour) DO UPDATE SET
      total_attempts = EXCLUDED.total_attempts,
      successful = EXCLUDED.successful,
      failed_transient = EXCLUDED.failed_transient,
      failed_permanent = EXCLUDED.failed_permanent,
      quarantined = EXCLUDED.quarantined,
      exponential_count = EXCLUDED.exponential_count,
      linear_count = EXCLUDED.linear_count,
      fixed_count = EXCLUDED.fixed_count,
      avg_backoff_seconds = EXCLUDED.avg_backoff_seconds,
      min_backoff_seconds = EXCLUDED.min_backoff_seconds,
      max_backoff_seconds = EXCLUDED.max_backoff_seconds,
      error_breakdown = EXCLUDED.error_breakdown,
      top_error = EXCLUDED.top_error,
      top_error_count = EXCLUDED.top_error_count,
      updated_at = CURRENT_TIMESTAMP;
  `;

  try {
    await db.pool.query(query);
    return { component: 'retry_engine', collected: true };
  } catch (error) {
    console.error("Error collecting retry metrics:", error);
    return { component: 'retry_engine', collected: false, error: error.message };
  }
}

/**
 * Collect quarantine metrics for the current hour
 * Analyzes queue size, age distribution, and recovery operations
 */
async function collectQuarantineMetrics() {
  const query = `
    INSERT INTO quarantine_metrics (
      date, hour,
      total_items, waiting_recovery, in_recovery, recovered, permanently_failed,
      items_0_1h, items_1_24h, items_1_7d, items_7d_plus,
      recovery_attempts, recovery_successes, recovery_failures, avg_recovery_attempts,
      work_type_breakdown, top_work_type, top_work_type_count
    )
    SELECT
      CURRENT_DATE as date,
      EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT as hour,
      COUNT(DISTINCT q.id) as total_items,
      COUNT(DISTINCT q.id) FILTER (WHERE q.recovery_status = 'waiting') as waiting_recovery,
      COUNT(DISTINCT q.id) FILTER (WHERE q.recovery_status = 'in_progress') as in_recovery,
      COUNT(DISTINCT q.id) FILTER (WHERE q.recovery_status = 'recovered') as recovered,
      COUNT(DISTINCT q.id) FILTER (WHERE q.recovery_status = 'permanently_failed') as permanently_failed,
      COUNT(DISTINCT q.id) FILTER (WHERE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - q.last_attempt_at))/3600 < 1) as items_0_1h,
      COUNT(DISTINCT q.id) FILTER (WHERE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - q.last_attempt_at))/3600 >= 1 AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - q.last_attempt_at))/3600 < 24) as items_1_24h,
      COUNT(DISTINCT q.id) FILTER (WHERE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - q.last_attempt_at))/3600 >= 24 AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - q.last_attempt_at))/86400 < 7) as items_1_7d,
      COUNT(DISTINCT q.id) FILTER (WHERE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - q.last_attempt_at))/86400 >= 7) as items_7d_plus,
      COUNT(DISTINCT r.id) as recovery_attempts,
      COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'succeeded') as recovery_successes,
      COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'failed') as recovery_failures,
      AVG(q.recovery_attempts) as avg_recovery_attempts,
      jsonb_object_agg(q.work_type, work_type_count) FILTER (WHERE q.work_type IS NOT NULL) as work_type_breakdown,
      (array_agg(q.work_type ORDER BY work_type_count DESC))[1] as top_work_type,
      (array_agg(work_type_count ORDER BY work_type_count DESC))[1] as top_work_type_count
    FROM quarantine_queue q
    LEFT JOIN recovery_operations r ON r.quarantine_id = q.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as work_type_count
      FROM quarantine_queue q2
      WHERE q2.work_type = q.work_type
    ) wt ON true
    WHERE q.created_at >= CURRENT_DATE
    GROUP BY date, hour
    ON CONFLICT (date, hour) DO UPDATE SET
      total_items = EXCLUDED.total_items,
      waiting_recovery = EXCLUDED.waiting_recovery,
      in_recovery = EXCLUDED.in_recovery,
      recovered = EXCLUDED.recovered,
      permanently_failed = EXCLUDED.permanently_failed,
      items_0_1h = EXCLUDED.items_0_1h,
      items_1_24h = EXCLUDED.items_1_24h,
      items_1_7d = EXCLUDED.items_1_7d,
      items_7d_plus = EXCLUDED.items_7d_plus,
      recovery_attempts = EXCLUDED.recovery_attempts,
      recovery_successes = EXCLUDED.recovery_successes,
      recovery_failures = EXCLUDED.recovery_failures,
      avg_recovery_attempts = EXCLUDED.avg_recovery_attempts,
      work_type_breakdown = EXCLUDED.work_type_breakdown,
      top_work_type = EXCLUDED.top_work_type,
      top_work_type_count = EXCLUDED.top_work_type_count,
      updated_at = CURRENT_TIMESTAMP;
  `;

  try {
    await db.pool.query(query);
    return { component: 'retry_engine', collected: true };
  } catch (error) {
    console.error("Error collecting quarantine metrics:", error);
    return { component: 'retry_engine', collected: false, error: error.message };
  }
}

/**
 * Collect event delivery metrics for the current hour
 * Aggregates by event_handler_name with latency percentiles
 */
async function collectDeliveryMetrics() {
  const query = `
    INSERT INTO event_delivery_metrics (
      date, hour, event_handler_name,
      total_events, successful, failed, quarantined, retried,
      avg_latency_ms, min_latency_ms, max_latency_ms,
      p50_latency_ms, p95_latency_ms, p99_latency_ms,
      success_rate_percent, retry_rate_percent,
      error_breakdown, top_error, top_error_count
    )
    SELECT
      CURRENT_DATE as date,
      EXTRACT(HOUR FROM o.created_at)::INT as hour,
      COALESCE(o.event_handler_name, 'unknown') as event_handler_name,
      COUNT(*) as total_events,
      COUNT(*) FILTER (WHERE o.status = 'completed') as successful,
      COUNT(*) FILTER (WHERE o.status = 'failed') as failed,
      COUNT(*) FILTER (WHERE o.quarantine_id IS NOT NULL) as quarantined,
      COUNT(*) FILTER (WHERE o.delivery_attempts > 1 AND o.status = 'completed') as retried,
      AVG(EXTRACT(EPOCH FROM (o.updated_at - COALESCE(o.delivery_started_at, o.created_at)))*1000)::DECIMAL as avg_latency_ms,
      MIN(EXTRACT(EPOCH FROM (o.updated_at - COALESCE(o.delivery_started_at, o.created_at)))*1000)::INT as min_latency_ms,
      MAX(EXTRACT(EPOCH FROM (o.updated_at - COALESCE(o.delivery_started_at, o.created_at)))*1000)::INT as max_latency_ms,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.updated_at - COALESCE(o.delivery_started_at, o.created_at)))*1000)::INT as p50_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.updated_at - COALESCE(o.delivery_started_at, o.created_at)))*1000)::INT as p95_latency_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.updated_at - COALESCE(o.delivery_started_at, o.created_at)))*1000)::INT as p99_latency_ms,
      ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = 'completed') / NULLIF(COUNT(*), 0))::DECIMAL as success_rate_percent,
      ROUND(100.0 * COUNT(*) FILTER (WHERE o.delivery_attempts > 1) / NULLIF(COUNT(*), 0))::DECIMAL as retry_rate_percent,
      jsonb_object_agg(error_type, error_count) FILTER (WHERE error_type IS NOT NULL) as error_breakdown,
      (array_agg(o.last_delivery_error ORDER BY error_occurrence DESC))[1] as top_error,
      (array_agg(error_occurrence ORDER BY error_occurrence DESC))[1]::INT as top_error_count
    FROM outbox_events o
    LEFT JOIN LATERAL (
      SELECT o.last_delivery_error as error_type, COUNT(*) as error_occurrence
      FROM outbox_events o2
      WHERE o2.event_handler_name = o.event_handler_name
        AND DATE(o2.created_at) = CURRENT_DATE
        AND EXTRACT(HOUR FROM o2.created_at)::INT = EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT
        AND o2.last_delivery_error IS NOT NULL
      GROUP BY o2.last_delivery_error
    ) err ON true
    WHERE DATE(o.created_at) = CURRENT_DATE
      AND EXTRACT(HOUR FROM o.created_at)::INT = EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT
    GROUP BY date, hour, event_handler_name
    ON CONFLICT (date, hour, event_handler_name) DO UPDATE SET
      total_events = EXCLUDED.total_events,
      successful = EXCLUDED.successful,
      failed = EXCLUDED.failed,
      quarantined = EXCLUDED.quarantined,
      retried = EXCLUDED.retried,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      min_latency_ms = EXCLUDED.min_latency_ms,
      max_latency_ms = EXCLUDED.max_latency_ms,
      p50_latency_ms = EXCLUDED.p50_latency_ms,
      p95_latency_ms = EXCLUDED.p95_latency_ms,
      p99_latency_ms = EXCLUDED.p99_latency_ms,
      success_rate_percent = EXCLUDED.success_rate_percent,
      retry_rate_percent = EXCLUDED.retry_rate_percent,
      error_breakdown = EXCLUDED.error_breakdown,
      top_error = EXCLUDED.top_error,
      top_error_count = EXCLUDED.top_error_count,
      updated_at = CURRENT_TIMESTAMP;
  `;

  try {
    await db.pool.query(query);
    return { component: 'outbox_processor', collected: true };
  } catch (error) {
    console.error("Error collecting delivery metrics:", error);
    return { component: 'outbox_processor', collected: false, error: error.message };
  }
}

/**
 * Collect job execution metrics for the current hour
 * Aggregates job_sla_metrics by job_name with performance percentiles
 */
async function collectJobMetrics() {
  const query = `
    INSERT INTO job_execution_metrics (
      date, hour, job_name,
      total_executions, successful, failed, timed_out,
      avg_duration_ms, min_duration_ms, max_duration_ms,
      p95_duration_ms, p99_duration_ms,
      sla_met, sla_breaches, max_consecutive_failures, consecutive_failures_at_end
    )
    SELECT
      CURRENT_DATE as date,
      EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT as hour,
      j.job_name,
      j.total_executions,
      j.successful_executions,
      j.failed_executions,
      j.timeout_executions,
      j.avg_duration_ms,
      j.min_duration_ms,
      j.max_duration_ms,
      j.p95_duration_ms,
      j.p99_duration_ms,
      COALESCE(j.sla_met, j.total_executions > 0 AND (j.failed_executions + j.timeout_executions) = 0) as sla_met,
      COALESCE(j.sla_breaches, j.failed_executions + j.timeout_executions, 0) as sla_breaches,
      0 as max_consecutive_failures,
      0 as consecutive_failures_at_end
    FROM job_sla_metrics j
    WHERE j.execution_date = CURRENT_DATE
      AND EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT >= 0
    ON CONFLICT (date, hour, job_name) DO UPDATE SET
      total_executions = EXCLUDED.total_executions,
      successful = EXCLUDED.successful,
      failed = EXCLUDED.failed,
      timed_out = EXCLUDED.timed_out,
      avg_duration_ms = EXCLUDED.avg_duration_ms,
      min_duration_ms = EXCLUDED.min_duration_ms,
      max_duration_ms = EXCLUDED.max_duration_ms,
      p95_duration_ms = EXCLUDED.p95_duration_ms,
      p99_duration_ms = EXCLUDED.p99_duration_ms,
      sla_met = EXCLUDED.sla_met,
      sla_breaches = EXCLUDED.sla_breaches,
      updated_at = CURRENT_TIMESTAMP;
  `;

  try {
    await db.pool.query(query);
    return { component: 'job_registry', collected: true };
  } catch (error) {
    console.error("Error collecting job metrics:", error);
    return { component: 'job_registry', collected: false, error: error.message };
  }
}

/**
 * Collect schema change metrics for the current day
 * Daily aggregation of schema modifications and migration performance
 */
async function collectSchemaMetrics() {
  const query = `
    INSERT INTO schema_change_metrics (
      date,
      total_changes, tables_modified, columns_added, columns_dropped,
      constraints_added, indexes_added,
      breaking_changes, deprecations, additions,
      avg_migration_time_ms, slowest_migration_name, slowest_migration_time_ms,
      schema_validity_issues, unindexed_foreign_keys
    )
    SELECT
      CURRENT_DATE as date,
      COUNT(*) as total_changes,
      COUNT(DISTINCT table_name) as tables_modified,
      COUNT(*) FILTER (WHERE change_type = 'column_added') as columns_added,
      COUNT(*) FILTER (WHERE change_type = 'column_dropped') as columns_dropped,
      COUNT(*) FILTER (WHERE change_type = 'constraint_added') as constraints_added,
      COUNT(*) FILTER (WHERE change_type = 'index_added') as indexes_added,
      COUNT(*) FILTER (WHERE is_breaking = true) as breaking_changes,
      COUNT(*) FILTER (WHERE is_deprecated = true) as deprecations,
      COUNT(*) FILTER (WHERE change_type IN ('column_added', 'index_added', 'constraint_added')) as additions,
      AVG(execution_time_ms) as avg_migration_time_ms,
      (array_agg(migration_name ORDER BY execution_time_ms DESC))[1] as slowest_migration_name,
      (array_agg(execution_time_ms ORDER BY execution_time_ms DESC))[1]::INT as slowest_migration_time_ms,
      0 as schema_validity_issues,
      0 as unindexed_foreign_keys
    FROM schema_change_log
    WHERE DATE(created_at) = CURRENT_DATE
    GROUP BY date
    ON CONFLICT (date) DO UPDATE SET
      total_changes = EXCLUDED.total_changes,
      tables_modified = EXCLUDED.tables_modified,
      columns_added = EXCLUDED.columns_added,
      columns_dropped = EXCLUDED.columns_dropped,
      constraints_added = EXCLUDED.constraints_added,
      indexes_added = EXCLUDED.indexes_added,
      breaking_changes = EXCLUDED.breaking_changes,
      deprecations = EXCLUDED.deprecations,
      additions = EXCLUDED.additions,
      avg_migration_time_ms = EXCLUDED.avg_migration_time_ms,
      slowest_migration_name = EXCLUDED.slowest_migration_name,
      slowest_migration_time_ms = EXCLUDED.slowest_migration_time_ms,
      updated_at = CURRENT_TIMESTAMP;
  `;

  try {
    await db.pool.query(query);
    return { component: 'schema_inventory', collected: true };
  } catch (error) {
    console.error("Error collecting schema metrics:", error);
    return { component: 'schema_inventory', collected: false, error: error.message };
  }
}

/**
 * Run all metrics collection
 * Called hourly by scheduled job
 */
async function runAllMetrics() {
  const start = Date.now();
  const results = [];

  try {
    // Hourly collections
    results.push(await collectRetryMetrics());
    results.push(await collectQuarantineMetrics());
    results.push(await collectDeliveryMetrics());
    results.push(await collectJobMetrics());

    // Daily collection (runs every hour but only inserts/updates for today)
    results.push(await collectSchemaMetrics());

    const duration = Date.now() - start;
    return {
      success: results.every(r => r.collected),
      results,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error in runAllMetrics:", error);
    return {
      success: false,
      error: error.message,
      results,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get metrics for specific component
 */
async function getComponentMetrics(componentName, daysBack = 7) {
  const tables = {
    'retry_engine': 'retry_metrics',
    'outbox_processor': 'event_delivery_metrics',
    'job_registry': 'job_execution_metrics',
    'schema_inventory': 'schema_change_metrics'
  };

  const table = tables[componentName];
  if (!table) {
    throw new Error(`Unknown component: ${componentName}`);
  }

  const query = `
    SELECT * FROM ${table}
    WHERE date >= CURRENT_DATE - INTERVAL '${daysBack} days'
    ORDER BY date DESC, hour DESC;
  `;

  const result = await db.pool.query(query);
  return result.rows;
}

/**
 * Get dashboard summary (current hour + last 24h trends)
 */
async function getDashboardSummary() {
  const hourlyQuery = `
    SELECT
      'retry' as metric_type,
      SUM(total_attempts) as attempts,
      SUM(successful) as successful,
      SUM(failed_permanent) as failed,
      AVG(avg_backoff_seconds) as avg_backoff
    FROM retry_metrics
    WHERE date = CURRENT_DATE AND hour = EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT
    UNION ALL
    SELECT
      'quarantine',
      SUM(total_items),
      SUM(recovered),
      SUM(permanently_failed),
      NULL
    FROM quarantine_metrics
    WHERE date = CURRENT_DATE AND hour = EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT
    UNION ALL
    SELECT
      'delivery',
      SUM(total_events),
      SUM(successful),
      SUM(failed),
      NULL
    FROM event_delivery_metrics
    WHERE date = CURRENT_DATE AND hour = EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INT
  `;

  const last24hQuery = `
    SELECT
      'retry_24h' as metric_type,
      SUM(total_attempts) as total,
      SUM(successful) as successful,
      ROUND(100.0 * SUM(successful) / NULLIF(SUM(total_attempts), 0))::INT as success_rate
    FROM retry_metrics
    WHERE date >= CURRENT_DATE - INTERVAL '1 day'
    UNION ALL
    SELECT
      'quarantine_24h',
      SUM(total_items),
      SUM(recovered),
      ROUND(100.0 * SUM(recovered) / NULLIF(SUM(total_items), 0))::INT
    FROM quarantine_metrics
    WHERE date >= CURRENT_DATE - INTERVAL '1 day'
  `;

  try {
    const hourly = await db.pool.query(hourlyQuery);
    const last24h = await db.pool.query(last24hQuery);

    return {
      current_hour: hourly.rows,
      last_24h: last24h.rows,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error getting dashboard summary:", error);
    return { error: error.message };
  }
}

module.exports = {
  collectRetryMetrics,
  collectQuarantineMetrics,
  collectDeliveryMetrics,
  collectJobMetrics,
  collectSchemaMetrics,
  runAllMetrics,
  getComponentMetrics,
  getDashboardSummary
};
