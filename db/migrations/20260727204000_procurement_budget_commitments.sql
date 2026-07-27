BEGIN;
CREATE TABLE IF NOT EXISTS procurement_budget_commitments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requisition_id BIGINT NOT NULL REFERENCES procurement_requisitions(id) ON DELETE CASCADE,
  budget_code VARCHAR(80) NOT NULL,
  committed_amount NUMERIC(14,2) NOT NULL CHECK (committed_amount >= 0),
  consumed_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  released_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  status VARCHAR(20) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','partially_consumed','consumed','released','cancelled')),
  idempotency_key VARCHAR(180) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,idempotency_key)
);
ALTER TABLE procurement_budget_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_budget_commitments_org ON procurement_budget_commitments USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;