CREATE TABLE IF NOT EXISTS backend_global_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  release_candidate TEXT NOT NULL,
  block_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  unresolved_dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, release_candidate)
);

CREATE INDEX IF NOT EXISTS backend_global_closures_organisation_idx
  ON backend_global_closures (organisation_id, created_at DESC);
