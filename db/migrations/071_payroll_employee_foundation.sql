BEGIN;

ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS employment_end_date DATE,
  ADD COLUMN IF NOT EXISTS pay_frequency TEXT NOT NULL DEFAULT 'biweekly',
  ADD COLUMN IF NOT EXISTS department_code TEXT,
  ADD COLUMN IF NOT EXISTS expense_account_id BIGINT,
  ADD COLUMN IF NOT EXISTS payable_account_id BIGINT,
  ADD COLUMN IF NOT EXISTS compensation_effective_from DATE,
  ADD COLUMN IF NOT EXISTS compensation_effective_to DATE;

DO $$ BEGIN
  ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_status_check
    CHECK (employment_status IN ('active','leave','terminated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_frequency_check
    CHECK (pay_frequency IN ('weekly','biweekly','semimonthly','monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_dates_check
    CHECK (employment_end_date IS NULL OR employment_end_date >= hire_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS payroll_compensation_history (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id),
  pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly','salary')),
  hourly_rate NUMERIC(14,2),
  annual_salary NUMERIC(14,2),
  pay_frequency TEXT NOT NULL CHECK (pay_frequency IN ('weekly','biweekly','semimonthly','monthly')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  reason TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((pay_type='hourly' AND hourly_rate > 0 AND annual_salary IS NULL) OR
         (pay_type='salary' AND annual_salary > 0 AND hourly_rate IS NULL)),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (organisation_id, employee_id, effective_from)
);

ALTER TABLE payroll_compensation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_compensation_history_org_isolation ON payroll_compensation_history;
CREATE POLICY payroll_compensation_history_org_isolation ON payroll_compensation_history
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

COMMIT;
