-- Migration: Stage 5 Health Check Probes
-- Integrates health monitoring for Schema Inventory (PR A), Job Registry (PR B),
-- Retry Engine (PR C), and Deferred Events (PR D)

-- Extend health_check_results with Stage 5 specific metadata
ALTER TABLE observability.health_check_results ADD COLUMN IF NOT EXISTS component_name VARCHAR(100);
ALTER TABLE observability.health_check_results ADD COLUMN IF NOT EXISTS alert_severity VARCHAR(50);  -- 'none', 'warning', 'critical'
ALTER TABLE observability.health_check_results ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE observability.health_check_results ADD COLUMN IF NOT EXISTS remediation_steps TEXT;

-- Create index for component-based queries
CREATE INDEX IF NOT EXISTS idx_health_checks_component ON observability.health_check_results(component_name, checked_at DESC);

-- Create index for alert severity
CREATE INDEX IF NOT EXISTS idx_health_checks_severity ON observability.health_check_results(alert_severity, checked_at DESC)
  WHERE alert_severity IN ('warning', 'critical');

-- Table for health check thresholds configuration
CREATE TABLE IF NOT EXISTS health_check_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_name VARCHAR(100) NOT NULL,
  component_name VARCHAR(100) NOT NULL,

  -- Thresholds
  warning_threshold JSONB,  -- {"max_items": 50, "max_age_seconds": 3600}
  critical_threshold JSONB, -- {"max_items": 100, "max_age_seconds": 7200}

  -- Configuration
  enabled BOOLEAN DEFAULT true,
  check_interval_seconds INT DEFAULT 300,
  description TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(probe_name, component_name)
);

-- Create index for threshold lookups
CREATE INDEX IF NOT EXISTS idx_health_thresholds_probe ON health_check_thresholds(probe_name, component_name);

-- Update trigger for health_check_thresholds
CREATE OR REPLACE FUNCTION update_health_thresholds_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS health_thresholds_update_timestamp ON health_check_thresholds;
CREATE TRIGGER health_thresholds_update_timestamp
BEFORE UPDATE ON health_check_thresholds
FOR EACH ROW
EXECUTE FUNCTION update_health_thresholds_timestamp();

-- Table for health check alerts
CREATE TABLE IF NOT EXISTS health_check_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_name VARCHAR(100) NOT NULL,
  probe_name VARCHAR(100) NOT NULL,
  alert_severity VARCHAR(50) NOT NULL,  -- 'warning', 'critical'

  -- Alert details
  message TEXT NOT NULL,
  details JSONB,
  remediation_steps TEXT,

  -- Status
  status VARCHAR(50) DEFAULT 'open',  -- 'open', 'acknowledged', 'resolved'
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by VARCHAR(255),
  resolved_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for alert queries
CREATE INDEX IF NOT EXISTS idx_health_alerts_status ON health_check_alerts(status, alert_severity);
CREATE INDEX IF NOT EXISTS idx_health_alerts_component ON health_check_alerts(component_name, status);
CREATE INDEX IF NOT EXISTS idx_health_alerts_created ON health_check_alerts(created_at DESC);

-- Update trigger for health_check_alerts
CREATE OR REPLACE FUNCTION update_health_alerts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS health_alerts_update_timestamp ON health_check_alerts;
CREATE TRIGGER health_alerts_update_timestamp
BEFORE UPDATE ON health_check_alerts
FOR EACH ROW
EXECUTE FUNCTION update_health_alerts_timestamp();

-- Predefined health check thresholds for Stage 5 components
INSERT INTO health_check_thresholds (
  probe_name,
  component_name,
  warning_threshold,
  critical_threshold,
  enabled,
  check_interval_seconds,
  description
) VALUES
  ('schema_consistency', 'schema_inventory',
   '{"schema_changes": 1}'::jsonb,
   '{"schema_changes": 1}'::jsonb,
   true, 300, 'Detect breaking schema changes'),

  ('job_registry_health', 'job_registry',
   '{"failed_jobs": 1, "overdue_jobs": 1}'::jsonb,
   '{"failed_jobs": 3, "overdue_jobs": 3}'::jsonb,
   true, 300, 'Monitor job execution health'),

  ('job_lock_tracking', 'job_registry',
   '{"stuck_locks": 1}'::jsonb,
   '{"stuck_locks": 3}'::jsonb,
   true, 300, 'Detect stuck or deadlocked jobs'),

  ('quarantine_queue_size', 'retry_engine',
   '{"max_items": 50, "max_age_seconds": 86400}'::jsonb,
   '{"max_items": 100, "max_age_seconds": 86400}'::jsonb,
   true, 300, 'Monitor dead-letter queue growth'),

  ('retry_policy_compliance', 'retry_engine',
   '{"incomplete_policies": 0}'::jsonb,
   '{"incomplete_policies": 1}'::jsonb,
   true, 3600, 'Validate retry policy configuration'),

  ('outbox_pending_events', 'outbox_processor',
   '{"max_pending": 500, "max_age_seconds": 3600}'::jsonb,
   '{"max_pending": 1000, "max_age_seconds": 3600}'::jsonb,
   true, 300, 'Monitor outbox event backlog'),

  ('outbox_delivery_latency', 'outbox_processor',
   '{"max_avg_latency_ms": 10000}'::jsonb,
   '{"max_avg_latency_ms": 30000}'::jsonb,
   true, 300, 'Monitor event delivery performance'),

  ('recovery_operations', 'retry_engine',
   '{"recovery_failure_rate": 0.2}'::jsonb,
   '{"recovery_failure_rate": 0.5}'::jsonb,
   true, 300, 'Monitor quarantine recovery success rate');

-- View for current health status summary
CREATE OR REPLACE VIEW observability.stage5_health_summary AS
SELECT
  component_name,
  COUNT(*) FILTER (WHERE status = 'healthy') as healthy_probes,
  COUNT(*) FILTER (WHERE status = 'degraded') as degraded_probes,
  COUNT(*) FILTER (WHERE status = 'unhealthy') as unhealthy_probes,
  COUNT(*) FILTER (WHERE alert_severity = 'warning') as warning_alerts,
  COUNT(*) FILTER (WHERE alert_severity = 'critical') as critical_alerts,
  MAX(CASE
    WHEN status = 'unhealthy' THEN 'unhealthy'
    WHEN status = 'degraded' THEN 'degraded'
    ELSE 'healthy'
  END) as overall_status,
  MAX(checked_at) as last_checked_at,
  AVG(latency_ms) as avg_latency_ms
FROM observability.health_check_results
WHERE checked_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
GROUP BY component_name;

-- View for active alerts
CREATE OR REPLACE VIEW observability.active_health_alerts AS
SELECT
  component_name,
  probe_name,
  alert_severity,
  COUNT(*) as alert_count,
  MIN(created_at) as first_alert_at,
  MAX(updated_at) as last_alert_at
FROM health_check_alerts
WHERE status = 'open'
GROUP BY component_name, probe_name, alert_severity
ORDER BY alert_severity DESC, last_alert_at DESC;

COMMENT ON TABLE health_check_thresholds IS 'Configurable alert thresholds for Stage 5 health probes';
COMMENT ON TABLE health_check_alerts IS 'Historical record of health check alerts for audit trail';
COMMENT ON VIEW observability.stage5_health_summary IS 'Current health status by component';
COMMENT ON VIEW observability.active_health_alerts IS 'Summary of active alerts requiring attention';
