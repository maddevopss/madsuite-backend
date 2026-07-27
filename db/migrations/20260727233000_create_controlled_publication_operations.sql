CREATE TABLE IF NOT EXISTS controlled_publication_operations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  release_identifier TEXT NOT NULL,
  source_commit_sha TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  readiness_gate_id BIGINT,
  deployment_started_at TIMESTAMPTZ,
  deployment_completed_at TIMESTAMPTZ,
  post_deploy_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_executed BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT controlled_publication_status_check CHECK (
    status IN ('planned', 'approved', 'deploying', 'verifying', 'completed', 'rolled_back', 'failed')
  ),
  CONSTRAINT controlled_publication_unique_release UNIQUE (organisation_id, environment, release_identifier)
);

CREATE INDEX IF NOT EXISTS idx_controlled_publication_operations_org_status
  ON controlled_publication_operations (organisation_id, status, created_at DESC);

ALTER TABLE controlled_publication_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS controlled_publication_operations_tenant_isolation
  ON controlled_publication_operations;

CREATE POLICY controlled_publication_operations_tenant_isolation
  ON controlled_publication_operations
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);
