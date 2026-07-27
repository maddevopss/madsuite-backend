BEGIN;

CREATE TABLE IF NOT EXISTS cognitive_assistance_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_number TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','evaluated','approved','closed','reopened')),
  evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_reason TEXT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS cognitive_assistance_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL REFERENCES cognitive_assistance_closures(id) ON DELETE CASCADE,
  control_code TEXT NOT NULL,
  control_status TEXT NOT NULL CHECK (control_status IN ('pass','fail','warning')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_id, control_code)
);

CREATE INDEX IF NOT EXISTS idx_cognitive_assistance_closures_status ON cognitive_assistance_closures(organisation_id,status,period_end DESC);
CREATE INDEX IF NOT EXISTS idx_cognitive_assistance_controls_closure ON cognitive_assistance_controls(organisation_id,closure_id,control_status);

ALTER TABLE cognitive_assistance_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_assistance_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cognitive_assistance_closures_org_isolation ON cognitive_assistance_closures;
CREATE POLICY cognitive_assistance_closures_org_isolation ON cognitive_assistance_closures USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS cognitive_assistance_controls_org_isolation ON cognitive_assistance_controls;
CREATE POLICY cognitive_assistance_controls_org_isolation ON cognitive_assistance_controls USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);

COMMIT;