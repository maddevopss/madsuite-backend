-- Migration: Stage 5 Metrics Pipeline
-- Comprehensive metrics collection and structured logging for all Stage 5 components

-- Table for operation logs (structured logging)
CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Operation identification
  operation_type VARCHAR(100) NOT NULL,  -- 'schema_change', 'job_execution', 'retry_attempt', 'event_delivery', etc.
  component_name VARCHAR(100) NOT NULL, -- 'schema_inventory', 'job_registry', 'retry_engine', 'outbox_processor'
  resource_type VARCHAR(100),             -- 'job', 'event', 'quarantine_item', 'policy', etc.
  resource_id VARCHAR(255),

  -- Context
  user_id VARCHAR(255),                   -- Who performed the action (null for system)
  action VARCHAR(50),                     -- 'CREATE', 'UPDATE', 'DELETE', 'EXECUTE', 'RETRY', etc.
  status VARCHAR(50) NOT NULL,            -- 'success', 'failure', 'warning'
  error_code VARCHAR(100),

  -- Details
  message TEXT,
  details JSONB,                          -- Operation-specific context
  duration_ms INT,                        -- Execution time
  severity VARCHAR(20),                   -- 'info', 'warning', 'error', 'critical'

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_operation_logs_component ON operation_logs(component_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_type ON operation_logs(operation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_status ON operation_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_resource ON operation_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_severity ON operation_logs(severity, created_at DESC)
  WHERE severity IN ('error', 'critical');
CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);

-- Table for retry metrics (time-series aggregation)
CREATE TABLE IF NOT EXISTS retry_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  hour INT,  -- 0-23 for hourly data

  -- Counts
  total_attempts INT DEFAULT 0,
  successful INT DEFAULT 0,
  failed_transient INT DEFAULT 0,
  failed_permanent INT DEFAULT 0,
  quarantined INT DEFAULT 0,

  -- Backoff distribution
  exponential_count INT DEFAULT 0,
  linear_count INT DEFAULT 0,
  fixed_count INT DEFAULT 0,

  -- Performance
  avg_backoff_seconds DECIMAL,
  min_backoff_seconds INT,
  max_backoff_seconds INT,

  -- Error breakdown
  error_breakdown JSONB,  -- {"TIMEOUT": 5, "NETWORK": 3, "VALIDATION": 2}
  top_error VARCHAR(100),
  top_error_count INT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(date, hour)
);

-- Create indexes for metrics queries
CREATE INDEX IF NOT EXISTS idx_retry_metrics_date ON retry_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_retry_metrics_hour ON retry_metrics(date DESC, hour DESC);

-- Table for quarantine metrics (time-series)
CREATE TABLE IF NOT EXISTS quarantine_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  hour INT,  -- 0-23

  -- Counts
  total_items INT DEFAULT 0,
  waiting_recovery INT DEFAULT 0,
  in_recovery INT DEFAULT 0,
  recovered INT DEFAULT 0,
  permanently_failed INT DEFAULT 0,

  -- Age analysis
  items_0_1h INT DEFAULT 0,
  items_1_24h INT DEFAULT 0,
  items_1_7d INT DEFAULT 0,
  items_7d_plus INT DEFAULT 0,

  -- Recovery metrics
  recovery_attempts INT DEFAULT 0,
  recovery_successes INT DEFAULT 0,
  recovery_failures INT DEFAULT 0,
  avg_recovery_attempts DECIMAL,

  -- Breakdown by work type
  work_type_breakdown JSONB,  -- {"email": 10, "webhook": 5, "payment": 2}
  top_work_type VARCHAR(100),
  top_work_type_count INT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(date, hour)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_quarantine_metrics_date ON quarantine_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_quarantine_metrics_hour ON quarantine_metrics(date DESC, hour DESC);

-- Table for event delivery metrics (extends outbox_delivery_stats)
CREATE TABLE IF NOT EXISTS event_delivery_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  hour INT,  -- 0-23
  event_handler_name VARCHAR(100) NOT NULL,

  -- Counts
  total_events INT DEFAULT 0,
  successful INT DEFAULT 0,
  failed INT DEFAULT 0,
  quarantined INT DEFAULT 0,
  retried INT DEFAULT 0,

  -- Performance
  avg_latency_ms DECIMAL,
  min_latency_ms INT,
  max_latency_ms INT,
  p50_latency_ms INT,
  p95_latency_ms INT,
  p99_latency_ms INT,

  -- Success rate
  success_rate_percent DECIMAL,
  retry_rate_percent DECIMAL,

  -- Error types
  error_breakdown JSONB,  -- {"TIMEOUT": 5, "AUTH_FAILED": 3}
  top_error VARCHAR(100),
  top_error_count INT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(date, hour, event_handler_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_event_delivery_metrics_date ON event_delivery_metrics(date DESC, event_handler_name);
CREATE INDEX IF NOT EXISTS idx_event_delivery_metrics_handler ON event_delivery_metrics(event_handler_name, date DESC);

-- Table for job execution metrics (extends job_sla_metrics)
CREATE TABLE IF NOT EXISTS job_execution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  hour INT,  -- 0-23
  job_name VARCHAR(100) NOT NULL,

  -- Counts
  total_executions INT DEFAULT 0,
  successful INT DEFAULT 0,
  failed INT DEFAULT 0,
  timed_out INT DEFAULT 0,

  -- Performance
  avg_duration_ms DECIMAL,
  min_duration_ms INT,
  max_duration_ms INT,
  p95_duration_ms INT,
  p99_duration_ms INT,

  -- SLA
  sla_met BOOLEAN,
  sla_breaches INT DEFAULT 0,

  -- Consecutive failures
  max_consecutive_failures INT DEFAULT 0,
  consecutive_failures_at_end INT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(date, hour, job_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_job_exec_metrics_date ON job_execution_metrics(date DESC, job_name);
CREATE INDEX IF NOT EXISTS idx_job_exec_metrics_job ON job_execution_metrics(job_name, date DESC);

-- Table for schema change metrics
CREATE TABLE IF NOT EXISTS schema_change_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,

  -- Counts
  total_changes INT DEFAULT 0,
  tables_modified INT DEFAULT 0,
  columns_added INT DEFAULT 0,
  columns_dropped INT DEFAULT 0,
  constraints_added INT DEFAULT 0,
  indexes_added INT DEFAULT 0,

  -- Change types
  breaking_changes INT DEFAULT 0,
  deprecations INT DEFAULT 0,
  additions INT DEFAULT 0,

  -- Migration performance
  avg_migration_time_ms DECIMAL,
  slowest_migration_name VARCHAR(255),
  slowest_migration_time_ms INT,

  -- Consistency
  schema_validity_issues INT DEFAULT 0,
  unindexed_foreign_keys INT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(date)
);

-- Update triggers
CREATE OR REPLACE FUNCTION update_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS retry_metrics_update ON retry_metrics;
CREATE TRIGGER retry_metrics_update BEFORE UPDATE ON retry_metrics
FOR EACH ROW EXECUTE FUNCTION update_metrics_timestamp();

DROP TRIGGER IF EXISTS quarantine_metrics_update ON quarantine_metrics;
CREATE TRIGGER quarantine_metrics_update BEFORE UPDATE ON quarantine_metrics
FOR EACH ROW EXECUTE FUNCTION update_metrics_timestamp();

DROP TRIGGER IF EXISTS event_delivery_metrics_update ON event_delivery_metrics;
CREATE TRIGGER event_delivery_metrics_update BEFORE UPDATE ON event_delivery_metrics
FOR EACH ROW EXECUTE FUNCTION update_metrics_timestamp();

DROP TRIGGER IF EXISTS job_exec_metrics_update ON job_execution_metrics;
CREATE TRIGGER job_exec_metrics_update BEFORE UPDATE ON job_execution_metrics
FOR EACH ROW EXECUTE FUNCTION update_metrics_timestamp();

DROP TRIGGER IF EXISTS schema_change_metrics_update ON schema_change_metrics;
CREATE TRIGGER schema_change_metrics_update BEFORE UPDATE ON schema_change_metrics
FOR EACH ROW EXECUTE FUNCTION update_metrics_timestamp();

-- Views for metrics dashboards

CREATE SCHEMA IF NOT EXISTS metrics;

-- Hourly metrics summary (last 24 hours)
CREATE OR REPLACE VIEW metrics.hourly_summary AS
SELECT
  COALESCE(rm.date, qm.date, edm.date, jem.date) as date,
  COALESCE(rm.hour, qm.hour, edm.hour, jem.hour) as hour,

  -- Retry metrics (MAX = pas d'agrégation réelle : au plus 1 ligne par date/hour
  -- dans retry_metrics ; MAX évite juste le "fan-out" créé par les FULL OUTER JOIN
  -- avec edm/jem qui, eux, ont plusieurs lignes par date/hour)
  MAX(rm.total_attempts) as retry_total,
  MAX(rm.successful) as retry_successful,
  MAX(rm.failed_transient) as retry_transient,
  MAX(rm.failed_permanent) as retry_permanent,

  -- Quarantine metrics (même raisonnement que retry_metrics)
  MAX(qm.total_items) as quarantine_items,
  MAX(qm.recovered) as quarantine_recovered,
  MAX(qm.recovery_attempts) as recovery_attempts,

  -- Delivery metrics (sum across handlers)
  SUM(edm.total_events)::INT as delivery_total,
  SUM(edm.successful)::INT as delivery_successful,
  AVG(edm.avg_latency_ms) as avg_delivery_latency_ms,

  -- Job metrics (sum across jobs)
  SUM(jem.total_executions)::INT as job_executions,
  SUM(jem.successful)::INT as job_successes,
  SUM(jem.sla_breaches)::INT as sla_breaches
FROM retry_metrics rm
FULL OUTER JOIN quarantine_metrics qm USING (date, hour)
FULL OUTER JOIN event_delivery_metrics edm USING (date, hour)
FULL OUTER JOIN job_execution_metrics jem USING (date, hour)
WHERE COALESCE(rm.date, qm.date, edm.date, jem.date) >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY COALESCE(rm.date, qm.date, edm.date, jem.date),
         COALESCE(rm.hour, qm.hour, edm.hour, jem.hour);

-- Daily metrics summary (last 30 days)
CREATE OR REPLACE VIEW metrics.daily_summary AS
SELECT
  date,
  SUM(total_attempts)::INT as retry_total,
  SUM(successful)::INT as retry_successful,
  SUM(quarantined)::INT as quarantined_items,
  AVG(avg_backoff_seconds) as avg_backoff_seconds
FROM retry_metrics
GROUP BY date
ORDER BY date DESC;

-- Error trends
CREATE OR REPLACE VIEW metrics.error_trends AS
SELECT
  date,
  hour,
  top_error as error_type,
  top_error_count as count,
  ROUND(100.0 * top_error_count / NULLIF(total_attempts, 0))::INT as percent_of_attempts
FROM retry_metrics
WHERE top_error IS NOT NULL
  AND date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC, hour DESC, count DESC;

-- SLA compliance tracking
CREATE OR REPLACE VIEW metrics.sla_compliance AS
SELECT
  date,
  job_name,
  total_executions,
  successful,
  timed_out,
  ROUND(100.0 * successful / NULLIF(total_executions, 0))::INT as success_rate_percent,
  sla_met,
  sla_breaches
FROM job_execution_metrics
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC, job_name;

COMMENT ON TABLE operation_logs IS 'Structured operational logs for audit trail and debugging';
COMMENT ON TABLE retry_metrics IS 'Time-series metrics for retry operations and backoff behavior';
COMMENT ON TABLE quarantine_metrics IS 'Time-series metrics for quarantine queue and recovery operations';
COMMENT ON TABLE event_delivery_metrics IS 'Time-series metrics for event delivery performance by handler';
COMMENT ON TABLE job_execution_metrics IS 'Time-series metrics for job execution performance and SLA compliance';
COMMENT ON TABLE schema_change_metrics IS 'Aggregated metrics for schema changes and migration performance';
