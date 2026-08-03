-- Stage 14 PR 14B: Structured Logging & Log Events

CREATE SCHEMA IF NOT EXISTS observability;

-- Log events table for centralized structured logging
CREATE TABLE IF NOT EXISTS observability.log_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
  service TEXT NOT NULL,
  logger_name TEXT,
  message TEXT NOT NULL,
  trace_id TEXT,  -- Link to observability.traces (PR 14A)
  context JSONB DEFAULT '{}',  -- {userId, action, resource_type, duration_ms}
  stack_trace TEXT,  -- ERROR+ only, redacted
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_log_events_organisation_time
  ON observability.log_events(organisation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_events_trace_id
  ON observability.log_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_log_events_level
  ON observability.log_events(level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_events_service
  ON observability.log_events(service, timestamp DESC);

-- Full-text search index for message content
CREATE INDEX IF NOT EXISTS idx_log_events_message_search
  ON observability.log_events
  USING GIN (to_tsvector('english', message));

-- RLS policies
ALTER TABLE observability.log_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view logs only for their organisation"
  ON observability.log_events
  FOR SELECT
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);

CREATE POLICY IF NOT EXISTS "System can insert logs for any organisation"
  ON observability.log_events
  FOR INSERT
  WITH CHECK (true);

-- Grants
GRANT SELECT ON observability.log_events TO authenticated;
GRANT INSERT ON observability.log_events TO authenticated;

-- Table metadata
COMMENT ON TABLE observability.log_events IS 'Structured logs from application services. Immutable audit trail. Sensitive fields are redacted.';
COMMENT ON COLUMN observability.log_events.level IS 'Log level: DEBUG < INFO < WARN < ERROR < FATAL';
COMMENT ON COLUMN observability.log_events.trace_id IS 'Correlation ID linking logs to traces (from PR 14A)';
COMMENT ON COLUMN observability.log_events.context IS 'Structured context: user_id, action, resource_type, duration_ms, error_code';
COMMENT ON COLUMN observability.log_events.stack_trace IS 'Exception stack trace (ERROR level+), redacted of sensitive data';
