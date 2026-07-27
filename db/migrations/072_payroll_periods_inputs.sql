BEGIN;

CREATE TABLE IF NOT EXISTS payroll_periods (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','semimonthly','monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','closed')),
  locked_at TIMESTAMPTZ,
  locked_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  CHECK (pay_date >= period_end),
  UNIQUE (organisation_id, frequency, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS payroll_variable_inputs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  payroll_period_id BIGINT NOT NULL REFERENCES payroll_periods(id),
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id),
  input_type TEXT NOT NULL CHECK (input_type IN ('regular_hours','overtime_hours','paid_leave','unpaid_leave','bonus','commission','taxable_benefit','reimbursement','adjustment')),
  quantity NUMERIC(14,4),
  amount NUMERIC(14,2),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity IS NOT NULL OR amount IS NOT NULL),
  UNIQUE (organisation_id, payroll_period_id, employee_id, input_type, source_type, source_id)
);

CREATE OR REPLACE FUNCTION prevent_locked_payroll_input_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payroll_periods p WHERE p.id=COALESCE(NEW.payroll_period_id,OLD.payroll_period_id) AND p.organisation_id=COALESCE(NEW.organisation_id,OLD.organisation_id) AND p.status <> 'open') THEN
    RAISE EXCEPTION 'Une période de paie verrouillée ne peut pas être modifiée';
  END IF;
  RETURN COALESCE(NEW,OLD);
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payroll_inputs_lock_guard ON payroll_variable_inputs;
CREATE TRIGGER payroll_inputs_lock_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_variable_inputs
FOR EACH ROW EXECUTE FUNCTION prevent_locked_payroll_input_change();

ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_variable_inputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_periods_org_isolation ON payroll_periods;
CREATE POLICY payroll_periods_org_isolation ON payroll_periods USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT);
DROP POLICY IF EXISTS payroll_inputs_org_isolation ON payroll_variable_inputs;
CREATE POLICY payroll_inputs_org_isolation ON payroll_variable_inputs USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT);

COMMIT;
