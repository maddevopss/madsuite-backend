BEGIN;
CREATE TABLE IF NOT EXISTS business_orchestration_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  process_key TEXT NOT NULL,
  process_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','closed','reopened')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, process_key, process_version)
);
CREATE TABLE IF NOT EXISTS business_orchestration_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL REFERENCES business_orchestration_closures(id) ON DELETE CASCADE,
  control_key TEXT NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_id, control_key)
);
ALTER TABLE business_orchestration_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_orchestration_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_orchestration_closures_org_isolation ON business_orchestration_closures;
CREATE POLICY business_orchestration_closures_org_isolation ON business_orchestration_closures USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS business_orchestration_controls_org_isolation ON business_orchestration_controls;
CREATE POLICY business_orchestration_controls_org_isolation ON business_orchestration_controls USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
COMMIT;