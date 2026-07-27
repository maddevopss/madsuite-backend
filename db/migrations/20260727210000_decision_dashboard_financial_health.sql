BEGIN;
CREATE TABLE IF NOT EXISTS decision_financial_health_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  revenue NUMERIC(16,2) NOT NULL DEFAULT 0,
  gross_margin NUMERIC(16,2) NOT NULL DEFAULT 0,
  receivables NUMERIC(16,2) NOT NULL DEFAULT 0,
  overdue_receivables NUMERIC(16,2) NOT NULL DEFAULT 0,
  payables NUMERIC(16,2) NOT NULL DEFAULT 0,
  payroll_due NUMERIC(16,2) NOT NULL DEFAULT 0,
  inventory_value NUMERIC(16,2) NOT NULL DEFAULT 0,
  health_score INTEGER NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  status VARCHAR(16) NOT NULL CHECK (status IN ('healthy','watch','critical')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, as_of_date)
);
COMMIT;