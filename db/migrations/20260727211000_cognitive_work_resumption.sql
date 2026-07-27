BEGIN;
CREATE TABLE IF NOT EXISTS cognitive_work_resumptions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  workspace_key VARCHAR(160) NOT NULL,
  objective TEXT NOT NULL,
  last_completed_step TEXT,
  next_action TEXT NOT NULL,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','resumed','closed','superseded')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumed_at TIMESTAMPTZ,
  source_hash VARCHAR(64) NOT NULL,
  UNIQUE (organisation_id,user_id,workspace_key,status)
);
CREATE INDEX IF NOT EXISTS idx_cognitive_resumption_active ON cognitive_work_resumptions(organisation_id,user_id,captured_at DESC) WHERE status='active';
COMMIT;
