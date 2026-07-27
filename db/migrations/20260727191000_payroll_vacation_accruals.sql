BEGIN;
CREATE TABLE IF NOT EXISTS payroll_vacation_accounts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  accrual_rate NUMERIC(8,4) NOT NULL DEFAULT 4 CHECK (accrual_rate >= 0),
  accrued_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  available_amount NUMERIC(14,2) GENERATED ALWAYS AS (accrued_amount-paid_amount) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,employee_id)
);
CREATE TABLE IF NOT EXISTS payroll_vacation_movements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  payroll_run_id BIGINT REFERENCES payroll_runs(id) ON DELETE SET NULL,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('accrual','payment','adjustment','reversal')),
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT,
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key)
);
ALTER TABLE payroll_vacation_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_vacation_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_vacation_accounts_org ON payroll_vacation_accounts USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY payroll_vacation_movements_org ON payroll_vacation_movements USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
