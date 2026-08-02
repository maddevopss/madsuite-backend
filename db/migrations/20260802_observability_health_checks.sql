-- Stage 14 PR 14C: Health Checks & Probes

-- Health check results table
CREATE TABLE IF NOT EXISTS observability.health_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy')),
  latency_ms INTEGER CHECK (latency_ms >= 0),
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL,
  next_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_health_checks_service_time
  ON observability.health_check_results(service_name, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_checks_status
  ON observability.health_check_results(status, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_checks_probe
  ON observability.health_check_results(probe_name, checked_at DESC);

-- Service health summary (latest check per service)
CREATE VIEW observability.health_summary AS
SELECT
  service_name,
  (ARRAY_AGG(status ORDER BY checked_at DESC))[1] as overall_status,
  (ARRAY_AGG(latency_ms ORDER BY checked_at DESC))[1] as latest_latency_ms,
  (ARRAY_AGG(checked_at ORDER BY checked_at DESC))[1] as last_checked_at,
  COUNT(*) FILTER (WHERE status = 'healthy') as healthy_probes,
  COUNT(*) FILTER (WHERE status = 'degraded') as degraded_probes,
  COUNT(*) FILTER (WHERE status = 'unhealthy') as unhealthy_probes,
  MAX(latency_ms) as max_latency_ms,
  AVG(latency_ms) as avg_latency_ms
FROM observability.health_check_results
WHERE checked_at > NOW() - INTERVAL '1 hour'
GROUP BY service_name;

-- Table metadata
COMMENT ON TABLE observability.health_check_results IS 'Health check probe results. Immutable record of service readiness and liveness checks.';
COMMENT ON COLUMN observability.health_check_results.probe_name IS 'Probe type: database, redis, queue, api, external_api, disk, memory';
COMMENT ON COLUMN observability.health_check_results.status IS 'healthy (all thresholds ok), degraded (some thresholds exceeded), unhealthy (service down)';
COMMENT ON COLUMN observability.health_check_results.latency_ms IS 'Response time in milliseconds';
COMMENT ON COLUMN observability.health_check_results.next_check_at IS 'When next check is scheduled';
COMMENT ON VIEW observability.health_summary IS 'Latest health status per service, last hour only';
