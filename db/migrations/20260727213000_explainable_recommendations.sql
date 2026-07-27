BEGIN;
CREATE TABLE IF NOT EXISTS assistance_recommendations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  recommendation_type VARCHAR(80) NOT NULL,
  recommendation TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','expired','cancelled')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_hash VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  UNIQUE (organisation_id,idempotency_key)
);
COMMIT;
