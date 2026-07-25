-- MADSuite — renversements clients, annulation de facture et notes de crédit.

ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversed_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS reversal_idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reversal_accounting_entry_id BIGINT REFERENCES accounting_entries(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_reversal_idempotency
  ON invoice_payments (organisation_id, reversal_idempotency_key)
  WHERE reversal_idempotency_key IS NOT NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS void_idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS void_accounting_entry_id BIGINT REFERENCES accounting_entries(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_void_idempotency
  ON invoices (organisation_id, void_idempotency_key)
  WHERE void_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS invoice_credit_notes (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  credit_number VARCHAR(80) NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal > 0),
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total NUMERIC(14,2) NOT NULL CHECK (total > 0),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  idempotency_key VARCHAR(120) NOT NULL,
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  UNIQUE (organisation_id, credit_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_invoice_credit_notes_invoice
  ON invoice_credit_notes (organisation_id, invoice_id, created_at DESC);

ALTER TABLE invoice_credit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisation_isolation ON invoice_credit_notes;
CREATE POLICY organisation_isolation ON invoice_credit_notes
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);

CREATE OR REPLACE FUNCTION prevent_credit_note_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une note de crédit comptabilisée ne peut pas être supprimée.';
  END IF;
  IF OLD.status = 'posted' AND NOT (
    NEW.status = 'reversed'
    AND NEW.id = OLD.id
    AND NEW.organisation_id = OLD.organisation_id
    AND NEW.invoice_id = OLD.invoice_id
    AND NEW.credit_number = OLD.credit_number
    AND NEW.subtotal = OLD.subtotal
    AND NEW.tax_total = OLD.tax_total
    AND NEW.total = OLD.total
    AND NEW.reason = OLD.reason
    AND NEW.idempotency_key = OLD.idempotency_key
    AND NEW.accounting_entry_id IS NOT DISTINCT FROM OLD.accounting_entry_id
    AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
    AND NEW.created_at = OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Une note de crédit comptabilisée est immuable.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_credit_notes_immutable ON invoice_credit_notes;
CREATE TRIGGER invoice_credit_notes_immutable
BEFORE UPDATE OR DELETE ON invoice_credit_notes
FOR EACH ROW EXECUTE FUNCTION prevent_credit_note_mutation();
