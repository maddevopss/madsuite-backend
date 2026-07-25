-- MADSuite — liaison contrôlée des dépenses à la comptabilité.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS accounting_status VARCHAR(16) NOT NULL DEFAULT 'unposted'
    CHECK (accounting_status IN ('unposted','posted','reversed')),
  ADD COLUMN IF NOT EXISTS accounting_entry_id BIGINT REFERENCES accounting_entries(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_accounting_entry
  ON expenses (organisation_id, accounting_entry_id)
  WHERE accounting_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_accounting_status
  ON expenses (organisation_id, accounting_status, expense_date);
