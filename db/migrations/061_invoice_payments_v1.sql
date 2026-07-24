BEGIN;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  method VARCHAR(32) NOT NULL CHECK (method IN ('cash', 'cheque', 'bank_transfer', 'card', 'stripe', 'other')),
  source VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'stripe', 'import')),
  external_reference VARCHAR(255),
  note TEXT,
  idempotency_key VARCHAR(255) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_payments_unique_idempotency UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_org_invoice
  ON invoice_payments (organisation_id, invoice_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_org_received
  ON invoice_payments (organisation_id, received_at DESC);

ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_payments_org_isolation ON invoice_payments;
CREATE POLICY invoice_payments_org_isolation ON invoice_payments
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
