BEGIN;
CREATE TABLE IF NOT EXISTS payroll_approval_steps (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL,
  step_code VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','waived')),
  required_role VARCHAR(32) NOT NULL,
  decided_by INTEGER REFERENCES utilisateurs(id),
  decided_at TIMESTAMPTZ,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (organisation_id,payroll_run_id,step_code),
  FOREIGN KEY (organisation_id,payroll_run_id) REFERENCES payroll_runs(organisation_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payroll_approval_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  minimum_approvers INTEGER NOT NULL DEFAULT 2 CHECK (minimum_approvers > 0),
  prohibit_self_approval BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (organisation_id,code)
);
ALTER TABLE payroll_approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_approval_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_approval_steps_org ON payroll_approval_steps USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY payroll_approval_policies_org ON payroll_approval_policies USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
