BEGIN;

CREATE TABLE IF NOT EXISTS production_readiness_gates (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  release_ref TEXT NOT NULL,
  configuration_validated BOOLEAN NOT NULL DEFAULT FALSE,
  migrations_validated BOOLEAN NOT NULL DEFAULT FALSE,
  healthchecks_validated BOOLEAN NOT NULL DEFAULT FALSE,
  tenant_isolation_validated BOOLEAN NOT NULL DEFAULT FALSE,
  backup_restore_validated BOOLEAN NOT NULL DEFAULT FALSE,
  rollback_validated BOOLEAN NOT NULL DEFAULT FALSE,
  monitoring_validated BOOLEAN NOT NULL DEFAULT FALSE,
  unresolved_critical_findings INTEGER NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, release_ref)
);

CREATE INDEX IF NOT EXISTS idx_production_readiness_gates_organisation
  ON production_readiness_gates (organisation_id, created_at DESC);

ALTER TABLE production_readiness_gates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_readiness_gates_tenant_isolation
  ON production_readiness_gates;
CREATE POLICY production_readiness_gates_tenant_isolation
  ON production_readiness_gates
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

COMMIT;
