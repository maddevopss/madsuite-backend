CREATE TABLE IF NOT EXISTS saas_platform_closures (
  id bigserial PRIMARY KEY,
  organisation_id bigint NOT NULL,
  plan_type text NOT NULL,
  entitlements_verified boolean NOT NULL DEFAULT false,
  quotas_verified boolean NOT NULL DEFAULT false,
  billing_verified boolean NOT NULL DEFAULT false,
  lifecycle_verified boolean NOT NULL DEFAULT false,
  administration_verified boolean NOT NULL DEFAULT false,
  support_verified boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by bigint,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_type)
);

ALTER TABLE saas_platform_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY saas_platform_closures_org_isolation ON saas_platform_closures
USING (organisation_id = current_setting('app.current_organisation_id', true)::bigint)
WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::bigint);