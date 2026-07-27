CREATE TABLE IF NOT EXISTS integration_ecosystem_controls (
  id bigserial PRIMARY KEY,
  organisation_id bigint NOT NULL,
  integration_key text NOT NULL,
  integration_type text NOT NULL CHECK (integration_type IN ('webhook','connector','import','export','synchronization')),
  delivery_verified boolean NOT NULL DEFAULT false,
  signature_verified boolean NOT NULL DEFAULT false,
  retry_verified boolean NOT NULL DEFAULT false,
  idempotency_verified boolean NOT NULL DEFAULT false,
  reconciliation_verified boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by bigint,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, integration_key)
);

ALTER TABLE integration_ecosystem_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_ecosystem_org_isolation ON integration_ecosystem_controls
USING (organisation_id = current_setting('app.current_organisation_id', true)::bigint)
WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::bigint);