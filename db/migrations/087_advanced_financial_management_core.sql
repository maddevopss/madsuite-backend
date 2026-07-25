CREATE TABLE IF NOT EXISTS financial_budgets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  budget_number TEXT NOT NULL,
  name TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  owner_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  total_revenue NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_expense NUMERIC(16,2) NOT NULL DEFAULT 0,
  allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  effective_from DATE,
  effective_to DATE,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, budget_number),
  UNIQUE (organisation_id, idempotency_key),
  CHECK (total_revenue >= 0),
  CHECK (total_expense >= 0),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS financial_forecasts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  forecast_number TEXT NOT NULL,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  prepared_by_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  forecast_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, forecast_number),
  UNIQUE (organisation_id, idempotency_key),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS financial_cash_positions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  position_date DATE NOT NULL,
  account_reference TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  opening_balance NUMERIC(16,2) NOT NULL,
  inflows NUMERIC(16,2) NOT NULL DEFAULT 0,
  outflows NUMERIC(16,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(16,2) NOT NULL,
  source_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  prepared_by_user_id BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, position_date, account_reference, currency),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS financial_funding_facilities (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  facility_number TEXT NOT NULL,
  facility_type TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  approved_limit NUMERIC(16,2) NOT NULL,
  drawn_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  interest_rate NUMERIC(8,5),
  starts_at DATE NOT NULL,
  matures_at DATE NOT NULL,
  covenants JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_by_user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, facility_number),
  UNIQUE (organisation_id, idempotency_key),
  CHECK (approved_limit > 0),
  CHECK (drawn_amount >= 0),
  CHECK (drawn_amount <= approved_limit),
  CHECK (matures_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS financial_scenarios (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  scenario_number TEXT NOT NULL,
  name TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  baseline_reference TEXT,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  projected_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  prepared_by_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, scenario_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_financial_budgets_status ON financial_budgets (organisation_id, fiscal_year, status);
CREATE INDEX IF NOT EXISTS idx_financial_forecasts_period ON financial_forecasts (organisation_id, period_start, period_end, status);
CREATE INDEX IF NOT EXISTS idx_financial_cash_positions_date ON financial_cash_positions (organisation_id, position_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_facilities_status ON financial_funding_facilities (organisation_id, status, matures_at);
CREATE INDEX IF NOT EXISTS idx_financial_scenarios_status ON financial_scenarios (organisation_id, status, scenario_type);
