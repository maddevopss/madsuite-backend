BEGIN;

CREATE TABLE IF NOT EXISTS inventory_accounting_postings (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  posting_type VARCHAR(24) NOT NULL CHECK (posting_type IN ('receipt','issue','adjustment_gain','adjustment_loss','transfer','return')),
  inventory_account_id BIGINT REFERENCES accounting_accounts(id),
  offset_account_id BIGINT REFERENCES accounting_accounts(id),
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,4) NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  status VARCHAR(20) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','posted','reversed','failed')),
  idempotency_key VARCHAR(160) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_accounting_postings_tx ON inventory_accounting_postings(organisation_id,transaction_id);
ALTER TABLE inventory_accounting_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_accounting_postings_org ON inventory_accounting_postings USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);

COMMIT;