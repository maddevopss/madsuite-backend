BEGIN;
CREATE TABLE IF NOT EXISTS assistance_audit_evidence (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  recommendation_id BIGINT,
  event_type VARCHAR(64) NOT NULL,
  actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('human','system','assistant')),
  actor_id INTEGER,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_version VARCHAR(80),
  model_reference VARCHAR(120),
  event_hash VARCHAR(64) NOT NULL,
  previous_event_hash VARCHAR(64),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,event_hash)
);
CREATE INDEX IF NOT EXISTS idx_assistance_audit_recommendation ON assistance_audit_evidence(organisation_id,recommendation_id,occurred_at);
COMMIT;
