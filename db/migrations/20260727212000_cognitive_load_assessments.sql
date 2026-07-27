BEGIN;
CREATE TABLE IF NOT EXISTS cognitive_load_assessments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_tasks INTEGER NOT NULL DEFAULT 0,
  context_switches INTEGER NOT NULL DEFAULT 0,
  interruptions INTEGER NOT NULL DEFAULT 0,
  overdue_items INTEGER NOT NULL DEFAULT 0,
  fatigue_signal NUMERIC(5,2) NOT NULL DEFAULT 0,
  load_score INTEGER NOT NULL CHECK (load_score BETWEEN 0 AND 100),
  status VARCHAR(16) NOT NULL CHECK (status IN ('normal','elevated','overloaded')),
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action TEXT,
  source_hash VARCHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cognitive_load_user_time ON cognitive_load_assessments(organisation_id,user_id,assessed_at DESC);
COMMIT;
