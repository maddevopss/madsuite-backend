CREATE TABLE IF NOT EXISTS accounting_journal_entries (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  memo TEXT,
  reference_type VARCHAR(80),
  reference_id VARCHAR(120),
  idempotency_key VARCHAR(180) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','reversed')),
  reversal_of_id BIGINT REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entry_id BIGINT NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  description TEXT,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_org_date ON accounting_journal_entries (organisation_id, entry_date, id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_entry ON accounting_journal_lines (entry_id, account_id);

ALTER TABLE accounting_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_journal_entries_org_isolation ON accounting_journal_entries
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint);
CREATE POLICY accounting_journal_lines_org_isolation ON accounting_journal_lines
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint);
