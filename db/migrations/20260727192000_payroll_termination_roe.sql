BEGIN;
CREATE TABLE IF NOT EXISTS payroll_terminations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  last_day_worked DATE NOT NULL,
  reason_code VARCHAR(16) NOT NULL,
  final_pay_date DATE NOT NULL,
  vacation_payout NUMERIC(14,2) NOT NULL DEFAULT 0,
  severance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','issued','cancelled')),
  roe_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,employee_id,last_day_worked)
);
ALTER TABLE payroll_terminations ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_terminations_org ON payroll_terminations USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
