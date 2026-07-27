BEGIN;
CREATE TABLE IF NOT EXISTS payroll_year_end_slips (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL CHECK (tax_year >= 2000),
  slip_type VARCHAR(16) NOT NULL CHECK (slip_type IN ('T4','RL1','T4A','RL2')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','issued','amended','cancelled')),
  boxes JSONB NOT NULL DEFAULT '{}'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash VARCHAR(128) NOT NULL,
  issued_at TIMESTAMPTZ,
  amended_from_id BIGINT REFERENCES payroll_year_end_slips(id),
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,employee_id,tax_year,slip_type,source_hash)
);
ALTER TABLE payroll_year_end_slips ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_year_end_slips_org ON payroll_year_end_slips USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
