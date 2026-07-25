-- MADSuite — paie transactionnelle et explicable

CREATE TABLE IF NOT EXISTS payroll_rulesets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  version VARCHAR(64) NOT NULL,
  province VARCHAR(2) NOT NULL DEFAULT 'QC',
  effective_from DATE NOT NULL,
  effective_to DATE,
  rules JSONB NOT NULL,
  checksum VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, version)
);

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS ruleset_id BIGINT REFERENCES payroll_rulesets(id),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS ct_mad_transaction_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_idempotency
  ON payroll_runs (organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ruleset_version VARCHAR(64),
  ADD COLUMN IF NOT EXISTS calculation_checksum VARCHAR(128);

CREATE TABLE IF NOT EXISTS payroll_payments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(40),
  reference VARCHAR(120),
  paid_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  created_by INTEGER REFERENCES utilisateurs(id),
  reversed_at TIMESTAMPTZ,
  reversed_by INTEGER REFERENCES utilisateurs(id),
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payroll_rulesets_active
  ON payroll_rulesets (organisation_id, province, effective_from, status);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_run
  ON payroll_payments (organisation_id, payroll_run_id, paid_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_rulesets','payroll_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int)', t
    );
  END LOOP;
END $$;
