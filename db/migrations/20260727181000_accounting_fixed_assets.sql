BEGIN;

CREATE TABLE IF NOT EXISTS accounting_fixed_assets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  asset_number VARCHAR(64) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  acquisition_date DATE NOT NULL,
  in_service_date DATE NOT NULL,
  acquisition_cost NUMERIC(14,2) NOT NULL CHECK (acquisition_cost >= 0),
  residual_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),
  depreciation_method VARCHAR(24) NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line')),
  asset_account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  accumulated_depreciation_account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  depreciation_expense_account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','disposed','written_off')),
  disposed_at DATE,
  disposal_proceeds NUMERIC(14,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, asset_number)
);

CREATE TABLE IF NOT EXISTS accounting_depreciation_runs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_id BIGINT REFERENCES accounting_periods(id),
  run_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  idempotency_key VARCHAR(160) NOT NULL,
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS accounting_depreciation_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  run_id BIGINT NOT NULL,
  fixed_asset_id BIGINT NOT NULL,
  depreciation_amount NUMERIC(14,2) NOT NULL CHECK (depreciation_amount >= 0),
  accumulated_amount NUMERIC(14,2) NOT NULL CHECK (accumulated_amount >= 0),
  net_book_value NUMERIC(14,2) NOT NULL CHECK (net_book_value >= 0),
  calculation_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id, run_id, fixed_asset_id),
  FOREIGN KEY (organisation_id, run_id) REFERENCES accounting_depreciation_runs(organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, fixed_asset_id) REFERENCES accounting_fixed_assets(organisation_id, id) ON DELETE CASCADE
);

ALTER TABLE accounting_fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_depreciation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_depreciation_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_fixed_assets_org ON accounting_fixed_assets USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY accounting_depreciation_runs_org ON accounting_depreciation_runs USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY accounting_depreciation_lines_org ON accounting_depreciation_lines USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
