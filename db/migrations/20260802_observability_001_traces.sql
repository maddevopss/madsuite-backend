-- Stage 14 PR 14A: Observability infrastructure - Distributed Tracing

-- Observability schema
CREATE SCHEMA IF NOT EXISTS observability;

-- Traces table for distributed tracing
CREATE TABLE IF NOT EXISTS observability.traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  service_name TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  duration_ms NUMERIC NOT NULL CHECK (duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  error_message TEXT,
  tags JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_traces_organisation_time
  ON observability.traces(organisation_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id
  ON observability.traces(trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_service
  ON observability.traces(service_name, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status
  ON observability.traces(status, start_time DESC);

-- RLS policies
ALTER TABLE observability.traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view traces only for their organisation" ON observability.traces;
CREATE POLICY "Users can view traces only for their organisation"
  ON observability.traces
  FOR SELECT
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);

DROP POLICY IF EXISTS "System can insert traces for any organisation" ON observability.traces;
CREATE POLICY "System can insert traces for any organisation"
  ON observability.traces
  FOR INSERT
  WITH CHECK (true);

-- Grants
GRANT SELECT ON observability.traces TO authenticated;
GRANT INSERT ON observability.traces TO authenticated;
GRANT USAGE ON SCHEMA observability TO authenticated;

-- Table metadata
COMMENT ON TABLE observability.traces IS 'Distributed traces from OpenTelemetry instrumentation. Immutable record of request lifecycle and performance.';
COMMENT ON COLUMN observability.traces.trace_id IS 'Correlation ID linking all spans within a single request';
COMMENT ON COLUMN observability.traces.parent_span_id IS 'Parent span ID for hierarchy (null for root spans)';
COMMENT ON COLUMN observability.traces.duration_ms IS 'Total duration in milliseconds from start to end';
COMMENT ON COLUMN observability.traces.status IS 'Outcome: success (0 errors), error (exceptions), timeout (exceeded limit)';
COMMENT ON COLUMN observability.traces.tags IS 'Context: {service, endpoint, http_method, status_code, user_id, resource_id}';
