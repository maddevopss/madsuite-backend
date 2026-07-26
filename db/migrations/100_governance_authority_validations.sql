CREATE TABLE IF NOT EXISTS governance_authority_validations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  actor_user_id BIGINT NOT NULL,
  authority_type TEXT NOT NULL,
  requested_scope TEXT,
  requested_amount NUMERIC(14,2),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  valid BOOLEAN NOT NULL,
  within_scope BOOLEAN NOT NULL,
  within_period BOOLEAN NOT NULL,
  active_conflict BOOLEAN NOT NULL,
  financial_limit NUMERIC(14,2),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_governance_authority_validations_subject
  ON governance_authority_validations (organisation_id, subject_type, subject_id, created_at DESC);
