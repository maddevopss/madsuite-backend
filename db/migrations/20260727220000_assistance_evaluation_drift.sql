BEGIN;
CREATE TABLE IF NOT EXISTS assistance_recommendation_evaluations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  recommendation_id BIGINT NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('useful','neutral','harmful','ignored','unknown')),
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  expected_value NUMERIC(16,4),
  observed_value NUMERIC(16,4),
  feedback TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,recommendation_id)
);
CREATE TABLE IF NOT EXISTS assistance_drift_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  recommendation_count INTEGER NOT NULL DEFAULT 0,
  acceptance_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  harmful_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  ignored_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  average_confidence NUMERIC(7,4) NOT NULL DEFAULT 0,
  drift_score INTEGER NOT NULL CHECK (drift_score BETWEEN 0 AND 100),
  status VARCHAR(16) NOT NULL CHECK (status IN ('stable','watch','stop')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash VARCHAR(64) NOT NULL,
  UNIQUE (organisation_id,period_start,period_end)
);
COMMIT;
