CREATE TABLE IF NOT EXISTS accounting_accounts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(160) NOT NULL,
  account_type VARCHAR(24) NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  normal_balance VARCHAR(6) NOT NULL CHECK (normal_balance IN ('debit','credit')),
  parent_id BIGINT REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  system_key VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code),
  UNIQUE (organisation_id, system_key)
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_org_type
  ON accounting_accounts (organisation_id, account_type, code);

ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_accounts_org_isolation ON accounting_accounts;
CREATE POLICY accounting_accounts_org_isolation ON accounting_accounts
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint);
