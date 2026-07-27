BEGIN;
CREATE TABLE IF NOT EXISTS payroll_bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  institution_number VARCHAR(3) NOT NULL,
  transit_number VARCHAR(5) NOT NULL,
  account_last4 VARCHAR(4) NOT NULL,
  encrypted_account JSONB NOT NULL,
  allocation_percent NUMERIC(8,4) NOT NULL DEFAULT 100 CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,employee_id,id)
);
CREATE TABLE IF NOT EXISTS payroll_payment_batches (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','exported','confirmed','void')),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_count INTEGER NOT NULL DEFAULT 0,
  file_hash VARCHAR(128),
  confirmation JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key)
);
ALTER TABLE payroll_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payment_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_bank_accounts_org ON payroll_bank_accounts USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY payroll_payment_batches_org ON payroll_payment_batches USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
