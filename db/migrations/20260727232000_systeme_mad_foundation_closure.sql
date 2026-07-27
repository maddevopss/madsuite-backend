BEGIN;
CREATE TABLE IF NOT EXISTS systeme_mad_foundation_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  foundation_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','closed','reopened')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, foundation_version)
);
CREATE TABLE IF NOT EXISTS systeme_mad_foundation_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL REFERENCES systeme_mad_foundation_closures(id) ON DELETE CASCADE,
  control_key TEXT NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_id, control_key)
);
ALTER TABLE systeme_mad_foundation_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE systeme_mad_foundation_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS systeme_mad_foundation_closures_org_isolation ON systeme_mad_foundation_closures;
CREATE POLICY systeme_mad_foundation_closures_org_isolation ON systeme_mad_foundation_closures USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS systeme_mad_foundation_controls_org_isolation ON systeme_mad_foundation_controls;
CREATE POLICY systeme_mad_foundation_controls_org_isolation ON systeme_mad_foundation_controls USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
COMMIT;