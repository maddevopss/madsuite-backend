-- 031_invoice_estimate_link.sql

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS estimate_id INTEGER REFERENCES estimates(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoices.estimate_id IS 'Lien vers la soumission ayant généré cette facture, le cas échéant.';
