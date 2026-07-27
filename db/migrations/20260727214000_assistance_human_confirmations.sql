BEGIN;
CREATE TABLE IF NOT EXISTS assistance_human_confirmations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  recommendation_id BIGINT NOT NULL,
  decided_by INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('accepted','rejected','deferred','modified')),
  decision_reason TEXT,
  modified_action JSONB,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  execution_reference VARCHAR(180),
  UNIQUE (organisation_id,recommendation_id)
);
COMMIT;
