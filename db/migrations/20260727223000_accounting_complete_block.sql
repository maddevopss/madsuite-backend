BEGIN;

CREATE TABLE IF NOT EXISTS accounting_block_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  period_id BIGINT,
  closure_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','closed','reopened','cancelled')),
  trial_balance_debits NUMERIC(16,2) NOT NULL DEFAULT 0,
  trial_balance_credits NUMERIC(16,2) NOT NULL DEFAULT 0,
  unresolved_entries INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_entries >= 0),
  unresolved_reconciliations INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_reconciliations >= 0),
  statement_snapshot_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  control_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_reason TEXT,
  prepared_by BIGINT,
  approved_by BIGINT,
  closed_by BIGINT,
  prepared_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS accounting_closure_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL REFERENCES accounting_block_closures(id) ON DELETE CASCADE,
  control_code TEXT NOT NULL,
  control_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','passed','failed','waived')),
  measured_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  threshold_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  justification TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by BIGINT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_id, control_code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_block_closures_org_status ON accounting_block_closures(organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_closure_controls_closure ON accounting_closure_controls(organisation_id, closure_id, status);

COMMIT;
