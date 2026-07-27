BEGIN;

CREATE TABLE IF NOT EXISTS payroll_employees (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  employee_number VARCHAR(64) NOT NULL,
  legal_first_name VARCHAR(120) NOT NULL,
  legal_last_name VARCHAR(120) NOT NULL,
  preferred_name VARCHAR(120),
  email VARCHAR(255),
  phone VARCHAR(40),
  employment_status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('draft','active','leave','terminated','archived')),
  hire_date DATE,
  termination_date DATE,
  department_code VARCHAR(80),
  position_title VARCHAR(160),
  manager_employee_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT payroll_employees_termination_dates_chk CHECK (
    termination_date IS NULL OR hire_date IS NULL OR termination_date >= hire_date
  ),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, employee_number),
  FOREIGN KEY (organisation_id, manager_employee_id)
    REFERENCES payroll_employees(organisation_id, id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_employees_org_status
  ON payroll_employees(organisation_id, employment_status);

CREATE INDEX IF NOT EXISTS idx_payroll_employees_org_name
  ON payroll_employees(organisation_id, legal_last_name, legal_first_name);

ALTER TABLE payroll_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_employees_org ON payroll_employees
  USING (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT
  )
  WITH CHECK (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT
  );

COMMIT;
