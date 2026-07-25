BEGIN;

CREATE TABLE IF NOT EXISTS environmental_permits (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_id BIGINT,
  permit_type VARCHAR(120) NOT NULL,
  permit_number VARCHAR(120) NOT NULL,
  issuing_authority VARCHAR(180) NOT NULL,
  issued_at DATE NOT NULL,
  expires_at DATE NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  proof_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, permit_number),
  CHECK (expires_at >= issued_at)
);

CREATE TABLE IF NOT EXISTS environmental_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_id BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  incident_type VARCHAR(120) NOT NULL,
  severity VARCHAR(40) NOT NULL,
  description TEXT NOT NULL,
  responsible_user_id BIGINT NOT NULL,
  immediate_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  proof_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(40) NOT NULL DEFAULT 'open',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (occurred_at <= reported_at)
);

CREATE TABLE IF NOT EXISTS environmental_inspections (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_id BIGINT NOT NULL,
  inspected_at TIMESTAMPTZ NOT NULL,
  inspector_user_id BIGINT NOT NULL,
  scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  non_conformities JSONB NOT NULL DEFAULT '[]'::jsonb,
  proof_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS environmental_corrective_actions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  source_type VARCHAR(60) NOT NULL,
  source_id BIGINT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'open',
  closure_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_by BIGINT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS environmental_metrics (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_id BIGINT,
  metric_type VARCHAR(80) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  value NUMERIC(18,6) NOT NULL,
  unit VARCHAR(40) NOT NULL,
  methodology TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  recorded_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS environmental_reports (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  report_type VARCHAR(100) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary TEXT NOT NULL,
  indicators JSONB NOT NULL DEFAULT '{}'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  proof_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  prepared_by BIGINT NOT NULL,
  approved_by BIGINT,
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_environmental_permits_org_expiry ON environmental_permits (organisation_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_environmental_incidents_org_status ON environmental_incidents (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_environmental_actions_org_due ON environmental_corrective_actions (organisation_id, due_at, status);
CREATE INDEX IF NOT EXISTS idx_environmental_metrics_org_period ON environmental_metrics (organisation_id, period_start, period_end);

COMMIT;
