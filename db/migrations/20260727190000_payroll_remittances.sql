BEGIN;
CREATE TABLE IF NOT EXISTS payroll_remittances (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT REFERENCES payroll_runs(id) ON DELETE SET NULL,
  authority VARCHAR(32) NOT NULL CHECK (authority IN ('CRA','RQ','CNESST','OTHER')),
  remittance_type VARCHAR(48) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  employee_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (employee_amount >= 0),
  employer_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (employer_amount >= 0),
  total_amount NUMERIC(14,2) GENERATED ALWAYS AS (employee_amount + employer_amount) STORED,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','submitted','paid','void')),
  confirmation_number VARCHAR(120),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL,
  submitted_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_payroll_remittances_due ON payroll_remittances(organisation_id,due_date,status);
ALTER TABLE payroll_remittances ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_remittances_org ON payroll_remittances USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
