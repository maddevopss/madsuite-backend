BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'payroll_runs'::regclass
      AND conname = 'uq_payroll_runs_org_id'
  ) THEN
    ALTER TABLE payroll_runs
      ADD CONSTRAINT uq_payroll_runs_org_id
      UNIQUE (organisation_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll_reconciliation_runs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL,
  expected_net NUMERIC(14,2) NOT NULL,
  deposited_net NUMERIC(14,2) NOT NULL,
  remitted_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('balanced','warning','blocked')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reconciled_by INTEGER REFERENCES utilisateurs(id),
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key VARCHAR(160) NOT NULL,
  UNIQUE (organisation_id,idempotency_key),
  FOREIGN KEY (organisation_id,payroll_run_id) REFERENCES payroll_runs(organisation_id,id) ON DELETE CASCADE
);
ALTER TABLE payroll_reconciliation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_reconciliation_runs_org ON payroll_reconciliation_runs USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
