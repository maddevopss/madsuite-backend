-- 049_analytics_events.sql

CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  -- We map tenant_id to organisation_id to respect the system's multi-tenant architecture and RLS
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  event_name VARCHAR(100) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_org_id ON analytics_events(organisation_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);

-- RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_events_isolation_policy ON analytics_events;
CREATE POLICY analytics_events_isolation_policy ON analytics_events
    FOR ALL
    USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', TRUE), '')::integer);
