BEGIN;
CREATE TABLE IF NOT EXISTS decision_dashboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  snapshot_type VARCHAR(40) NOT NULL,
  period_start DATE,
  period_end DATE,
  payload JSONB NOT NULL,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash VARCHAR(64) NOT NULL,
  generated_by INTEGER REFERENCES utilisateurs(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  UNIQUE (organisation_id, snapshot_type, source_hash)
);
COMMIT;