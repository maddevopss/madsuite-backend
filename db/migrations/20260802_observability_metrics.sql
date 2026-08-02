-- Stage 14 PR 14D: Metrics & Error Budget Tracking

-- Metrics table for Prometheus-style metrics
CREATE TABLE IF NOT EXISTS observability.metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('gauge', 'counter', 'histogram', 'summary')),
  labels JSONB DEFAULT '{}',  -- {service, endpoint, status_code, method}
  value NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_metrics_name_time
  ON observability.metrics(metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_org_time
  ON observability.metrics(organisation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp
  ON observability.metrics(timestamp DESC);

-- SLA burn rate tracking (computed from traces)
CREATE TABLE IF NOT EXISTS observability.sla_burn_rate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  service_name TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  sla_target_pct NUMERIC NOT NULL CHECK (sla_target_pct BETWEEN 0 AND 100),
  actual_uptime_pct NUMERIC NOT NULL CHECK (actual_uptime_pct BETWEEN 0 AND 100),
  error_budget_total_minutes NUMERIC NOT NULL,
  error_budget_used_minutes NUMERIC NOT NULL,
  error_budget_remaining_minutes NUMERIC NOT NULL,
  error_budget_used_pct NUMERIC NOT NULL,
  burn_rate_pct_per_hour NUMERIC,  -- How fast budget being consumed
  alert_fired BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Indexes for SLA tracking
CREATE INDEX IF NOT EXISTS idx_sla_org_service_time
  ON observability.sla_burn_rate(organisation_id, service_name, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_sla_alert_status
  ON observability.sla_burn_rate(alert_fired, period_start DESC);

-- Latency percentiles view (computed from traces)
CREATE VIEW observability.latency_percentiles AS
SELECT
  service_name,
  date_trunc('minute', start_time) as minute,
  COUNT(*) as request_count,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_ms,
  MAX(duration_ms) as max_ms,
  AVG(duration_ms)::NUMERIC(10,2) as avg_ms
FROM observability.traces
WHERE start_time > NOW() - INTERVAL '24 hours'
GROUP BY service_name, date_trunc('minute', start_time);

-- Error rate view
CREATE VIEW observability.error_rates AS
SELECT
  service_name,
  date_trunc('minute', start_time) as minute,
  COUNT(*) as total_requests,
  COUNT(*) FILTER (WHERE status = 'error') as error_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'error') / COUNT(*)::NUMERIC, 2) as error_rate_pct
FROM observability.traces
WHERE start_time > NOW() - INTERVAL '24 hours'
GROUP BY service_name, date_trunc('minute', start_time);

-- Throughput (requests per minute)
CREATE VIEW observability.throughput_metrics AS
SELECT
  service_name,
  date_trunc('minute', start_time) as minute,
  COUNT(*) as requests_per_minute,
  COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / COUNT(*)::NUMERIC * 100 as success_rate_pct
FROM observability.traces
WHERE start_time > NOW() - INTERVAL '24 hours'
GROUP BY service_name, date_trunc('minute', start_time);

-- RLS policies for metrics
ALTER TABLE observability.metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.sla_burn_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view metrics only for their organisation"
  ON observability.metrics
  FOR SELECT
  USING (organisation_id IS NULL OR organisation_id = current_setting('app.current_organisation_id')::uuid);

CREATE POLICY IF NOT EXISTS "Users can view SLA only for their organisation"
  ON observability.sla_burn_rate
  FOR SELECT
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);

CREATE POLICY IF NOT EXISTS "System can insert metrics"
  ON observability.metrics
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "System can insert SLA records"
  ON observability.sla_burn_rate
  FOR INSERT
  WITH CHECK (true);

-- Grants
GRANT SELECT ON observability.metrics TO authenticated;
GRANT SELECT ON observability.sla_burn_rate TO authenticated;
GRANT SELECT ON observability.latency_percentiles TO authenticated;
GRANT SELECT ON observability.error_rates TO authenticated;
GRANT SELECT ON observability.throughput_metrics TO authenticated;
GRANT INSERT ON observability.metrics TO authenticated;
GRANT INSERT ON observability.sla_burn_rate TO authenticated;

-- Table metadata
COMMENT ON TABLE observability.metrics IS 'Prometheus-style metrics (gauge, counter, histogram, summary). Supports dimensional data via labels.';
COMMENT ON TABLE observability.sla_burn_rate IS 'SLA tracking per service. Computed from traces. Error budget burn rate triggers alerts.';
COMMENT ON VIEW observability.latency_percentiles IS 'p50/p95/p99 latency per service per minute, last 24 hours.';
COMMENT ON VIEW observability.error_rates IS 'Error rate % per service per minute, last 24 hours.';
COMMENT ON VIEW observability.throughput_metrics IS 'Requests per minute and success rate per service.';
