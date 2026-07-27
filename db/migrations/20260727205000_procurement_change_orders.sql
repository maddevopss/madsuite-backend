BEGIN;
CREATE TABLE IF NOT EXISTS procurement_purchase_order_versions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  purchase_order_id BIGINT NOT NULL REFERENCES procurement_purchase_orders(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  previous_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  revised_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  change_reason TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','applied','cancelled')),
  requested_by BIGINT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,purchase_order_id,version_number), UNIQUE (organisation_id,idempotency_key)
);
ALTER TABLE procurement_purchase_order_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_purchase_order_versions_org ON procurement_purchase_order_versions USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;