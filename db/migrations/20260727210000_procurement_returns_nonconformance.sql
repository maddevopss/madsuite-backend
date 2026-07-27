BEGIN;
CREATE TABLE IF NOT EXISTS procurement_receipt_exceptions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  receipt_id BIGINT NOT NULL REFERENCES procurement_receipts(id) ON DELETE CASCADE,
  purchase_order_id BIGINT NOT NULL REFERENCES procurement_purchase_orders(id),
  exception_type VARCHAR(32) NOT NULL CHECK (exception_type IN ('damage','shortage','overage','wrong_item','quality','late','other')),
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  estimated_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','return_authorized','returned','credited','closed')),
  supplier_reference VARCHAR(160),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution TEXT,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,idempotency_key)
);
ALTER TABLE procurement_receipt_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_receipt_exceptions_org ON procurement_receipt_exceptions USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;