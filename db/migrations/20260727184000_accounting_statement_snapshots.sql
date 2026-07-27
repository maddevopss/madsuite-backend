BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'accounting_periods'::regclass
      AND conname = 'uq_accounting_periods_org_id'
  ) THEN
    ALTER TABLE accounting_periods
      ADD CONSTRAINT uq_accounting_periods_org_id
      UNIQUE (organisation_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounting_statement_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_id BIGINT,
  statement_type VARCHAR(24) NOT NULL CHECK (statement_type IN ('income_statement','balance_sheet','cash_flow','trial_balance')),
  as_of_date DATE NOT NULL,
  comparison_start DATE,
  comparison_end DATE,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  payload JSONB NOT NULL,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash VARCHAR(128) NOT NULL,
  generated_by INTEGER REFERENCES utilisateurs(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,statement_type,as_of_date,source_hash),
  FOREIGN KEY (organisation_id,period_id) REFERENCES accounting_periods(organisation_id,id)
);
CREATE INDEX IF NOT EXISTS idx_accounting_statement_snapshots_lookup ON accounting_statement_snapshots(organisation_id,statement_type,as_of_date DESC);
ALTER TABLE accounting_statement_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_snapshots_org ON accounting_statement_snapshots USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
