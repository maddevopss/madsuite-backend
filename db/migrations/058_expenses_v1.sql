-- 058_expenses_v1.sql
-- Extension non destructive du module Dépenses existant.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS supplier VARCHAR(160),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'CAD',
  ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS receipt_mime_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS receipt_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS receipt_storage_key TEXT,
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

CREATE INDEX IF NOT EXISTS idx_expenses_org_date
  ON expenses (organisation_id, expense_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_org_category
  ON expenses (organisation_id, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_org_supplier
  ON expenses (organisation_id, supplier)
  WHERE deleted_at IS NULL AND supplier IS NOT NULL;
