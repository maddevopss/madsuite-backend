BEGIN;

CREATE TABLE IF NOT EXISTS payroll_employment_contracts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL,
  contract_number VARCHAR(80) NOT NULL,
  contract_type VARCHAR(24) NOT NULL CHECK (contract_type IN ('permanent','fixed_term','temporary','casual','internship')),
  employment_class VARCHAR(24) NOT NULL CHECK (employment_class IN ('full_time','part_time','on_call')),
  pay_type VARCHAR(16) NOT NULL CHECK (pay_type IN ('hourly','salary')),
  hourly_rate NUMERIC(14,2),
  annual_salary NUMERIC(14,2),
  standard_hours_per_week NUMERIC(6,2) NOT NULL CHECK (standard_hours_per_week >= 0 AND standard_hours_per_week <= 168),
  pay_frequency VARCHAR(20) NOT NULL CHECK (pay_frequency IN ('weekly','biweekly','semimonthly','monthly')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded','ended','cancelled')),
  terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_document_id BIGINT,
  approved_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_contract_compensation_chk CHECK (
    (pay_type = 'hourly' AND hourly_rate > 0 AND annual_salary IS NULL)
    OR (pay_type = 'salary' AND annual_salary > 0 AND hourly_rate IS NULL)
  ),
  CONSTRAINT payroll_contract_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, contract_number),
  FOREIGN KEY (organisation_id, employee_id)
    REFERENCES payroll_employees(organisation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payroll_contracts_employee_dates
  ON payroll_employment_contracts(organisation_id, employee_id, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_active_contract_per_employee
  ON payroll_employment_contracts(organisation_id, employee_id)
  WHERE status = 'active';

ALTER TABLE payroll_employment_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_employment_contracts_org ON payroll_employment_contracts;
CREATE POLICY payroll_employment_contracts_org ON payroll_employment_contracts
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

COMMIT;
