-- MADSuite — renversements contrôlés des paiements

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversal_idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reversed_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS reversal_accounting_entry_id BIGINT REFERENCES accounting_entries(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_reversal_idempotency
  ON supplier_payments (organisation_id, reversal_idempotency_key)
  WHERE reversal_idempotency_key IS NOT NULL;

ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversal_idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reversed_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS reversal_accounting_entry_id BIGINT REFERENCES accounting_entries(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_reversal_idempotency
  ON invoice_payments (organisation_id, reversal_idempotency_key)
  WHERE reversal_idempotency_key IS NOT NULL;
