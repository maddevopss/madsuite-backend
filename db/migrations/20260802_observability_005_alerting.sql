-- Stage 14 PR 14E: Alerting & Escalation

CREATE SCHEMA IF NOT EXISTS observability;

-- Alert rules table
CREATE TABLE IF NOT EXISTS observability.alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  condition TEXT NOT NULL,  -- "sla_burn_rate > 10%/hr" or "error_rate > 1%"
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  enabled BOOLEAN DEFAULT true,
  runbook_ref TEXT,  -- Link to runbook (PR 14F)
  notification_channels TEXT[],  -- ['slack', 'pagerduty', 'email']
  cooldown_minutes INTEGER DEFAULT 30,  -- Don't re-alert for this duration
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Active alerts table
CREATE TABLE IF NOT EXISTS observability.active_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL,
  organisation_id INTEGER NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  ack_by UUID,  -- User who acknowledged
  ack_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  escalation_level INTEGER DEFAULT 0,  -- 0=oncall, 1=manager, 2=cto
  resolved_at TIMESTAMPTZ,
  incident_ref TEXT,  -- Link to incident (Stage 8B)
  context JSONB,  -- {service, threshold, current_value, trend}
  notification_sent_at TIMESTAMPTZ,

  CONSTRAINT fk_rule
    FOREIGN KEY (rule_id) REFERENCES observability.alert_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Alert silence/suppression
CREATE TABLE IF NOT EXISTS observability.alert_silences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL,
  organisation_id INTEGER NOT NULL,
  silenced_by UUID NOT NULL,  -- User who silenced
  silenced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  until_at TIMESTAMPTZ NOT NULL,  -- When silence expires
  reason TEXT,  -- Why silenced
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_rule
    FOREIGN KEY (rule_id) REFERENCES observability.alert_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Alert history (audit trail)
CREATE TABLE IF NOT EXISTS observability.alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL,
  event_type TEXT NOT NULL,  -- triggered, acknowledged, escalated, resolved, silenced
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,  -- User who performed action
  context JSONB,  -- {message, escalation_level}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_alert
    FOREIGN KEY (alert_id) REFERENCES observability.active_alerts(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_alert_rules_org_enabled
  ON observability.alert_rules(organisation_id, enabled);
CREATE INDEX IF NOT EXISTS idx_active_alerts_rule_org
  ON observability.active_alerts(rule_id, organisation_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_alerts_unresolved
  ON observability.active_alerts(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_active_alerts_unack
  ON observability.active_alerts(ack_at) WHERE ack_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_silences_until
  ON observability.alert_silences(until_at);
CREATE INDEX IF NOT EXISTS idx_alert_history_alert
  ON observability.alert_history(alert_id, event_at DESC);

-- RLS policies
ALTER TABLE observability.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.active_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.alert_silences ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.alert_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view alert rules for their organisation" ON observability.alert_rules;
CREATE POLICY "Users can view alert rules for their organisation"
  ON observability.alert_rules
  FOR SELECT
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', TRUE), '')::integer);

DROP POLICY IF EXISTS "Users can view active alerts for their organisation" ON observability.active_alerts;
CREATE POLICY "Users can view active alerts for their organisation"
  ON observability.active_alerts
  FOR SELECT
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', TRUE), '')::integer);

DROP POLICY IF EXISTS "Users can view alert silences for their organisation" ON observability.alert_silences;
CREATE POLICY "Users can view alert silences for their organisation"
  ON observability.alert_silences
  FOR SELECT
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', TRUE), '')::integer);

DROP POLICY IF EXISTS "Users can view alert history for their organisation" ON observability.alert_history;
CREATE POLICY "Users can view alert history for their organisation"
  ON observability.alert_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM observability.active_alerts
      WHERE id = alert_history.alert_id
        AND organisation_id = NULLIF(current_setting('app.current_organisation_id', TRUE), '')::integer
    )
  );

DROP POLICY IF EXISTS "System can insert alert rules" ON observability.alert_rules;
CREATE POLICY "System can insert alert rules"
  ON observability.alert_rules
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert active alerts" ON observability.active_alerts;
CREATE POLICY "System can insert active alerts"
  ON observability.active_alerts
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "System can update active alerts" ON observability.active_alerts;
CREATE POLICY "System can update active alerts"
  ON observability.active_alerts
  FOR UPDATE
  WITH CHECK (true);

-- Grants
GRANT SELECT ON observability.alert_rules TO PUBLIC;
GRANT SELECT ON observability.active_alerts TO PUBLIC;
GRANT SELECT ON observability.alert_silences TO PUBLIC;
GRANT SELECT ON observability.alert_history TO PUBLIC;
GRANT INSERT ON observability.alert_rules TO PUBLIC;
GRANT INSERT ON observability.active_alerts TO PUBLIC;
GRANT UPDATE ON observability.active_alerts TO PUBLIC;

-- Table metadata
COMMENT ON TABLE observability.alert_rules IS 'Alert rules define conditions that trigger alerts. Includes severity, runbook refs, notification channels.';
COMMENT ON TABLE observability.active_alerts IS 'Currently active alerts. Tracks acknowledgement, escalation, resolution.';
COMMENT ON TABLE observability.alert_silences IS 'Temporary alert suppressions (e.g., during maintenance).';
COMMENT ON TABLE observability.alert_history IS 'Immutable audit trail of alert events: triggered, ack, escalate, resolve.';
