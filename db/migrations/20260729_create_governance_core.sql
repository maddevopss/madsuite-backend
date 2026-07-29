BEGIN;

CREATE TABLE IF NOT EXISTS governance_cases (
  id UUID PRIMARY KEY,
  organisation_id UUID NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('observation','analysis','decision','approval','execution','verification','closure')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, aggregate_type, aggregate_id)
);

CREATE TABLE IF NOT EXISTS governance_commands (
  id UUID PRIMARY KEY,
  governance_case_id UUID NOT NULL REFERENCES governance_cases(id),
  organisation_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS governance_approvals (
  id UUID PRIMARY KEY,
  governance_case_id UUID NOT NULL REFERENCES governance_cases(id),
  organisation_id UUID NOT NULL,
  approver_id UUID NOT NULL,
  role TEXT NOT NULL,
  decision_version INTEGER NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (governance_case_id, approver_id, decision_version)
);

CREATE TABLE IF NOT EXISTS governance_events (
  id UUID PRIMARY KEY,
  governance_case_id UUID NOT NULL REFERENCES governance_cases(id),
  organisation_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash TEXT NOT NULL,
  integrity_signature TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS governance_cases_org_idx ON governance_cases(organisation_id);
CREATE INDEX IF NOT EXISTS governance_events_case_idx ON governance_events(governance_case_id, occurred_at);
CREATE INDEX IF NOT EXISTS governance_commands_case_idx ON governance_commands(governance_case_id, created_at);

ALTER TABLE governance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY governance_cases_tenant_policy ON governance_cases
USING (organisation_id::text = current_setting('app.current_organisation_id', true));
CREATE POLICY governance_commands_tenant_policy ON governance_commands
USING (organisation_id::text = current_setting('app.current_organisation_id', true));
CREATE POLICY governance_approvals_tenant_policy ON governance_approvals
USING (organisation_id::text = current_setting('app.current_organisation_id', true));
CREATE POLICY governance_events_tenant_policy ON governance_events
USING (organisation_id::text = current_setting('app.current_organisation_id', true));

COMMIT;
