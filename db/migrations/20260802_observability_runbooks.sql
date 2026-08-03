-- Stage 14 PR 14F: Runbooks & Root Cause Analysis

CREATE SCHEMA IF NOT EXISTS observability;

-- Runbooks table
CREATE TABLE IF NOT EXISTS observability.runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID,
  name TEXT NOT NULL,
  alert_trigger TEXT,  -- Links to alert rule name
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  steps JSONB NOT NULL,  -- Array of {step_number, description, action, verification, timeout_seconds}
  owner_id UUID,  -- Owner user
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deprecated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- RCA (Root Cause Analysis) records
CREATE TABLE IF NOT EXISTS observability.incident_rca (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  incident_number TEXT NOT NULL UNIQUE,  -- INC-001, INC-002...
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  detection_time TIMESTAMPTZ,
  resolution_time TIMESTAMPTZ,
  severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')),

  -- RCA Analysis
  root_cause TEXT,  -- Primary cause
  contributing_factors TEXT[],  -- Secondary factors
  impact_summary TEXT,  -- What was affected
  lessons_learned TEXT[],  -- What we learned

  -- Corrective Actions
  actions JSONB,  -- Array of {action_id, description, owner, due_date, status, completed_date}

  -- Blameless postmortem
  timeline JSONB,  -- Array of {time, event, actor, details}
  facilitator_id UUID,  -- Who ran the postmortem
  participants TEXT[],  -- Emails of attendees

  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_organisation
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
);

-- Runbook execution history
CREATE TABLE IF NOT EXISTS observability.runbook_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id UUID NOT NULL,
  executed_by UUID NOT NULL,
  incident_ref TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'success', 'partial', 'failed')),

  -- Step execution tracking
  steps_executed JSONB,  -- Array of step results: {step_num, completed, duration_ms, output, error}

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_runbook
    FOREIGN KEY (runbook_id) REFERENCES observability.runbooks(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_runbooks_org_active
  ON observability.runbooks(organisation_id, is_active);
CREATE INDEX IF NOT EXISTS idx_runbooks_alert_trigger
  ON observability.runbooks(alert_trigger);
CREATE INDEX IF NOT EXISTS idx_rca_org_status
  ON observability.incident_rca(organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rca_incident_number
  ON observability.incident_rca(incident_number);
CREATE INDEX IF NOT EXISTS idx_rca_severity
  ON observability.incident_rca(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runbook_executions_runbook
  ON observability.runbook_executions(runbook_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runbook_executions_status
  ON observability.runbook_executions(status, started_at DESC);

-- RLS policies
ALTER TABLE observability.runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.incident_rca ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.runbook_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view runbooks for their organisation"
  ON observability.runbooks
  FOR SELECT
  USING (organisation_id IS NULL OR organisation_id = current_setting('app.current_organisation_id')::uuid);

CREATE POLICY IF NOT EXISTS "Users can view RCA for their organisation"
  ON observability.incident_rca
  FOR SELECT
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);

CREATE POLICY IF NOT EXISTS "Users can view executions for their organisation"
  ON observability.runbook_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM observability.runbooks
      WHERE id = runbook_executions.runbook_id
        AND (organisation_id IS NULL OR organisation_id = current_setting('app.current_organisation_id')::uuid)
    )
  );

CREATE POLICY IF NOT EXISTS "System can insert runbooks"
  ON observability.runbooks
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "System can insert RCA records"
  ON observability.incident_rca
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "System can update RCA records"
  ON observability.incident_rca
  FOR UPDATE
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "System can insert executions"
  ON observability.runbook_executions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "System can update executions"
  ON observability.runbook_executions
  FOR UPDATE
  WITH CHECK (true);

-- Grants
GRANT SELECT ON observability.runbooks TO authenticated;
GRANT SELECT ON observability.incident_rca TO authenticated;
GRANT SELECT ON observability.runbook_executions TO authenticated;
GRANT INSERT ON observability.runbooks TO authenticated;
GRANT INSERT ON observability.incident_rca TO authenticated;
GRANT INSERT ON observability.runbook_executions TO authenticated;
GRANT UPDATE ON observability.incident_rca TO authenticated;
GRANT UPDATE ON observability.runbook_executions TO authenticated;

-- Table metadata
COMMENT ON TABLE observability.runbooks IS 'Executable incident response procedures. Linked to alert rules. Versioned.';
COMMENT ON TABLE observability.incident_rca IS 'Post-incident analysis: timeline, root cause, actions, blameless postmortem.';
COMMENT ON TABLE observability.runbook_executions IS 'Audit trail of runbook execution: steps completed, duration, outcomes.';
COMMENT ON COLUMN observability.runbooks.steps IS 'Array of {step_number, description, action (command/API call), verification, timeout_seconds}';
COMMENT ON COLUMN observability.incident_rca.timeline IS 'Immutable timeline: when what happened and who was involved';
COMMENT ON COLUMN observability.incident_rca.actions IS 'Follow-up actions to prevent recurrence: owner, due date, status';
