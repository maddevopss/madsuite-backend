BEGIN;

ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS legal_first_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS legal_last_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS position_title VARCHAR(160),
  ADD COLUMN IF NOT EXISTS manager_employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE payroll_employees
SET
  legal_first_name = COALESCE(legal_first_name, legal_name),
  legal_last_name = COALESCE(legal_last_name, '')
WHERE legal_first_name IS NULL OR legal_last_name IS NULL;

ALTER TABLE payroll_employees
  ALTER COLUMN legal_first_name SET NOT NULL,
  ALTER COLUMN legal_last_name SET NOT NULL;

ALTER TABLE payroll_employees
  DROP CONSTRAINT IF EXISTS payroll_employees_status_check;

ALTER TABLE payroll_employees
  ADD CONSTRAINT payroll_employees_status_check
  CHECK (employment_status IN ('draft','active','leave','terminated','archived'));

ALTER TABLE payroll_employees
  DROP CONSTRAINT IF EXISTS payroll_employees_termination_dates_chk;

ALTER TABLE payroll_employees
  ADD CONSTRAINT payroll_employees_termination_dates_chk CHECK (
    termination_date IS NULL OR termination_date >= hire_date
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_employees_org_id
  ON payroll_employees(organisation_id, id);

DO $$ BEGIN
  ALTER TABLE payroll_employees
    ADD CONSTRAINT payroll_employees_manager_fk
    FOREIGN KEY (organisation_id, manager_employee_id)
    REFERENCES payroll_employees(organisation_id, id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_payroll_employees_org_status
  ON payroll_employees(organisation_id, employment_status);

CREATE INDEX IF NOT EXISTS idx_payroll_employees_org_name
  ON payroll_employees(organisation_id, legal_last_name, legal_first_name);

ALTER TABLE payroll_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_employees_org ON payroll_employees;
CREATE POLICY payroll_employees_org ON payroll_employees
  USING (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT
  )
  WITH CHECK (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT
  );

COMMIT;
