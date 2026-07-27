BEGIN;
CREATE TABLE IF NOT EXISTS observability_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','closed','reopened')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, scope_key)
);
CREATE TABLE IF NOT EXISTS observability_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL REFERENCES observability_closures(id) ON DELETE CASCADE,
  control_key TEXT NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_id, control_key)
);
ALTER TABLE observability_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS observability_closures_org_isolation ON observability_closures;
CREATE POLICY observability_closures_org_isolation ON observability_closures USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS observability_controls_org_isolation ON observability_controls;
CREATE POLICY observability_controls_org_isolation ON observability_controls USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
COMMIT;