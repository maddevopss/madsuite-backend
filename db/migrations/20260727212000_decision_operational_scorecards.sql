BEGIN;
CREATE TABLE IF NOT EXISTS decision_operational_scorecards (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  payroll_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
  inventory_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
  supplier_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
  billing_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
  completion_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, period_start, period_end)
);
COMMIT;