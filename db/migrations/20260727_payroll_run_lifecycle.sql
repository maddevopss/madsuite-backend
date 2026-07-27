ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS payroll_period_id BIGINT,
  ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_period_active_unique
  ON payroll_runs (organisation_id, payroll_period_id)
  WHERE payroll_period_id IS NOT NULL AND status <> 'void';

CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_creation_idempotency_unique
  ON payroll_runs (organisation_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

ALTER TABLE payroll_rulesets
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_by BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_rulesets_one_active_scope
  ON payroll_rulesets (organisation_id, province)
  WHERE status = 'active';
