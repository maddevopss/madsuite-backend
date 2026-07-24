-- 058_expenses_v1.sql
-- Extension non destructive du module Dépenses existant.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS supplier VARCHAR(160),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'CAD',
  ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS receipt_mime_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS receipt_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_at TIMESTAMPTZ;

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_currency_format;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_currency_format
  CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_receipt_size_non_negative;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_receipt_size_non_negative
  CHECK (receipt_size_bytes IS NULL OR receipt_size_bytes >= 0);

CREATE TABLE IF NOT EXISTS expense_receipts (
  expense_id INTEGER PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT expense_receipts_mime_type_allowed
    CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png'))
);

CREATE INDEX IF NOT EXISTS idx_expense_receipts_org
  ON expense_receipts (organisation_id);

DROP TRIGGER IF EXISTS trg_expense_receipts_updated_at ON expense_receipts;
CREATE TRIGGER trg_expense_receipts_updated_at
BEFORE UPDATE ON expense_receipts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_expenses_org_date
  ON expenses (organisation_id, expense_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_org_category
  ON expenses (organisation_id, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_org_supplier
  ON expenses (organisation_id, supplier)
  WHERE deleted_at IS NULL AND supplier IS NOT NULL;