BEGIN;
CREATE TABLE IF NOT EXISTS decision_cashflow_forecasts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  horizon_days INTEGER NOT NULL DEFAULT 30 CHECK (horizon_days > 0),
  opening_cash NUMERIC(16,2) NOT NULL DEFAULT 0,
  expected_inflows NUMERIC(16,2) NOT NULL DEFAULT 0,
  expected_outflows NUMERIC(16,2) NOT NULL DEFAULT 0,
  projected_closing_cash NUMERIC(16,2) NOT NULL DEFAULT 0,
  lowest_projected_cash NUMERIC(16,2) NOT NULL DEFAULT 0,
  risk_status VARCHAR(16) NOT NULL CHECK (risk_status IN ('stable','watch','shortfall')),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash VARCHAR(64) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, horizon_days, generated_at)
);
COMMIT;