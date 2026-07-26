-- Bloc 1 / #310 — comptabilité complète en partie double
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(160) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  subtype VARCHAR(40),
  parent_id UUID REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  normal_balance VARCHAR(6) NOT NULL CHECK (normal_balance IN ('debit','credit')),
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  system_key VARCHAR(60),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code),
  UNIQUE (organisation_id, system_key)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on),
  UNIQUE (organisation_id, starts_on, ends_on)
);

CREATE TABLE IF NOT EXISTS accounting_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entry_number BIGSERIAL,
  entry_date DATE NOT NULL,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  source_type VARCHAR(40),
  source_id VARCHAR(120),
  idempotency_key VARCHAR(160),
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  posted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  reversed_by_entry_id UUID REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  description TEXT,
  debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  client_id UUID,
  projet_id UUID,
  supplier_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_org_type ON accounting_accounts(organisation_id, type, code);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_org_dates ON accounting_periods(organisation_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_org_date ON accounting_journal_entries(organisation_id, entry_date, status);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_source ON accounting_journal_entries(organisation_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_entry ON accounting_journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON accounting_journal_lines(organisation_id, account_id);

CREATE OR REPLACE FUNCTION accounting_prevent_posted_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('posted','reversed') THEN
    RAISE EXCEPTION 'Une écriture comptabilisée ne peut pas être modifiée ou supprimée';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_entry_immutable ON accounting_journal_entries;
CREATE TRIGGER trg_accounting_entry_immutable
BEFORE UPDATE OR DELETE ON accounting_journal_entries
FOR EACH ROW EXECUTE FUNCTION accounting_prevent_posted_mutation();

ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_journal_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_accounts','accounting_periods','accounting_journal_entries','accounting_journal_lines'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_org_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      t, t
    );
  END LOOP;
END $$;
