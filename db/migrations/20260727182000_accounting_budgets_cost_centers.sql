BEGIN;
CREATE TABLE IF NOT EXISTS accounting_cost_centers (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(140) NOT NULL,
  parent_id BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,code),
  FOREIGN KEY (organisation_id,parent_id) REFERENCES accounting_cost_centers(organisation_id,id)
);
CREATE TABLE IF NOT EXISTS accounting_budgets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  fiscal_year INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','locked','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  approved_by INTEGER REFERENCES utilisateurs(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,name,fiscal_year,version)
);
CREATE TABLE IF NOT EXISTS accounting_budget_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  budget_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  cost_center_id BIGINT,
  period_number INTEGER NOT NULL CHECK (period_number BETWEEN 1 AND 13),
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  UNIQUE (organisation_id,budget_id,account_id,cost_center_id,period_number),
  FOREIGN KEY (organisation_id,budget_id) REFERENCES accounting_budgets(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,cost_center_id) REFERENCES accounting_cost_centers(organisation_id,id)
);
ALTER TABLE accounting_entry_lines ADD COLUMN IF NOT EXISTS cost_center_id BIGINT;
ALTER TABLE accounting_entry_lines ADD CONSTRAINT IF NOT EXISTS accounting_entry_lines_cost_center_fk FOREIGN KEY (organisation_id,cost_center_id) REFERENCES accounting_cost_centers(organisation_id,id);
ALTER TABLE accounting_cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_cost_centers_org ON accounting_cost_centers USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY accounting_budgets_org ON accounting_budgets USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY accounting_budget_lines_org ON accounting_budget_lines USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
