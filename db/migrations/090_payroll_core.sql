BEGIN;

CREATE TABLE IF NOT EXISTS payroll_employee_profiles (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  employee_number TEXT NOT NULL,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('hourly','salary')),
  province_code TEXT NOT NULL DEFAULT 'QC',
  hire_date DATE NOT NULL,
  termination_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, utilisateur_id),
  UNIQUE (organisation_id, employee_number)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','approved','paid','cancelled')),
  idempotency_key TEXT NOT NULL,
  approved_by INTEGER REFERENCES utilisateurs(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payroll_run_employees (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_profile_id BIGINT NOT NULL REFERENCES payroll_employee_profiles(id),
  gross_cents BIGINT NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),
  deduction_total_cents BIGINT NOT NULL DEFAULT 0 CHECK (deduction_total_cents >= 0),
  employer_contribution_total_cents BIGINT NOT NULL DEFAULT 0 CHECK (employer_contribution_total_cents >= 0),
  net_cents BIGINT NOT NULL DEFAULT 0 CHECK (net_cents >= 0),
  calculation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_profile_id),
  CHECK (gross_cents - deduction_total_cents = net_cents)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_employee_id BIGINT NOT NULL REFERENCES payroll_run_employees(id) ON DELETE CASCADE,
  component_code TEXT NOT NULL,
  component_kind TEXT NOT NULL CHECK (component_kind IN ('earning','deduction','employer_contribution','reimbursement')),
  amount_cents BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reversal_of BIGINT REFERENCES payroll_items(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org_period ON payroll_runs (organisation_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_items_org_run_employee ON payroll_items (organisation_id, payroll_run_employee_id);

ALTER TABLE payroll_employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_employee_profiles_org_isolation ON payroll_employee_profiles USING (organisation_id = current_setting('app.current_organisation_id', true)::int) WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::int);
CREATE POLICY payroll_runs_org_isolation ON payroll_runs USING (organisation_id = current_setting('app.current_organisation_id', true)::int) WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::int);
CREATE POLICY payroll_run_employees_org_isolation ON payroll_run_employees USING (organisation_id = current_setting('app.current_organisation_id', true)::int) WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::int);
CREATE POLICY payroll_items_org_isolation ON payroll_items USING (organisation_id = current_setting('app.current_organisation_id', true)::int) WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::int);

COMMIT;
