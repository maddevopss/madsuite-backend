CREATE TABLE IF NOT EXISTS public_api_governance (
  id bigserial PRIMARY KEY,
  organisation_id bigint NOT NULL,
  api_version text NOT NULL,
  contract_status text NOT NULL CHECK (contract_status IN ('draft','active','deprecated','retired')),
  authentication_verified boolean NOT NULL DEFAULT false,
  rate_limits_verified boolean NOT NULL DEFAULT false,
  idempotency_verified boolean NOT NULL DEFAULT false,
  documentation_verified boolean NOT NULL DEFAULT false,
  compatibility_verified boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by bigint,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, api_version)
);

ALTER TABLE public_api_governance ENABLE ROW LEVEL SECURITY;

CREATE POLICY public_api_governance_org_isolation ON public_api_governance
USING (organisation_id = current_setting('app.current_organisation_id', true)::bigint)
WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::bigint);