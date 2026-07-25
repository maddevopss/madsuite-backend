-- MADSuite — comptabilité Phase B
-- Périodes comptables, idempotence, plan comptable initial et immutabilité complète.

CREATE TABLE IF NOT EXISTS accounting_periods (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  period_number INTEGER NOT NULL CHECK (period_number BETWEEN 1 AND 13),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at TIMESTAMPTZ,
  closed_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (starts_on <= ends_on),
  UNIQUE (organisation_id, fiscal_year, period_number)
);

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisation_isolation ON accounting_periods;
CREATE POLICY organisation_isolation ON accounting_periods
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_entry_source
  ON accounting_entries (organisation_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND status <> 'reversed';

CREATE INDEX IF NOT EXISTS idx_accounting_entries_ledger
  ON accounting_entries (organisation_id, entry_date, id)
  WHERE status = 'posted';

CREATE OR REPLACE FUNCTION prevent_posted_accounting_line_mutation() RETURNS trigger AS $$
DECLARE entry_status VARCHAR(16);
BEGIN
  SELECT status INTO entry_status
  FROM accounting_entries
  WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);

  IF entry_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Les lignes d’une écriture publiée sont immuables.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounting_lines_immutable_when_posted ON accounting_entry_lines;
CREATE TRIGGER accounting_lines_immutable_when_posted
BEFORE INSERT OR UPDATE OR DELETE ON accounting_entry_lines
FOR EACH ROW EXECUTE FUNCTION prevent_posted_accounting_line_mutation();

CREATE OR REPLACE FUNCTION ensure_accounting_period_open() RETURNS trigger AS $$
DECLARE period_status VARCHAR(16);
BEGIN
  SELECT status INTO period_status
  FROM accounting_periods
  WHERE organisation_id = NEW.organisation_id
    AND NEW.entry_date BETWEEN starts_on AND ends_on
  ORDER BY starts_on DESC
  LIMIT 1;

  IF period_status IN ('closed', 'locked') THEN
    RAISE EXCEPTION 'La période comptable correspondant à cette date est fermée.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounting_entry_period_guard ON accounting_entries;
CREATE TRIGGER accounting_entry_period_guard
BEFORE INSERT OR UPDATE OF entry_date, status ON accounting_entries
FOR EACH ROW EXECUTE FUNCTION ensure_accounting_period_open();

CREATE OR REPLACE FUNCTION seed_default_chart_of_accounts(target_organisation_id INTEGER)
RETURNS INTEGER AS $$
DECLARE inserted_count INTEGER;
BEGIN
  INSERT INTO accounting_accounts
    (organisation_id, code, name, account_type, normal_balance)
  VALUES
    (target_organisation_id, '1000', 'Encaisse', 'asset', 'debit'),
    (target_organisation_id, '1010', 'Compte bancaire', 'asset', 'debit'),
    (target_organisation_id, '1100', 'Comptes clients', 'asset', 'debit'),
    (target_organisation_id, '1200', 'Inventaire', 'asset', 'debit'),
    (target_organisation_id, '1300', 'Taxes à recevoir', 'asset', 'debit'),
    (target_organisation_id, '2000', 'Comptes fournisseurs', 'liability', 'credit'),
    (target_organisation_id, '2100', 'Taxes à remettre', 'liability', 'credit'),
    (target_organisation_id, '2200', 'Salaires et retenues à payer', 'liability', 'credit'),
    (target_organisation_id, '3000', 'Avoir du propriétaire', 'equity', 'credit'),
    (target_organisation_id, '3100', 'Bénéfices non répartis', 'equity', 'credit'),
    (target_organisation_id, '4000', 'Revenus de services', 'revenue', 'credit'),
    (target_organisation_id, '4100', 'Ventes de produits', 'revenue', 'credit'),
    (target_organisation_id, '5000', 'Coût des marchandises vendues', 'expense', 'debit'),
    (target_organisation_id, '6000', 'Salaires et charges sociales', 'expense', 'debit'),
    (target_organisation_id, '6100', 'Loyer', 'expense', 'debit'),
    (target_organisation_id, '6200', 'Télécommunications', 'expense', 'debit'),
    (target_organisation_id, '6300', 'Fournitures et logiciels', 'expense', 'debit'),
    (target_organisation_id, '6400', 'Déplacements', 'expense', 'debit'),
    (target_organisation_id, '6900', 'Autres dépenses', 'expense', 'debit')
  ON CONFLICT (organisation_id, code) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  INSERT INTO accounting_journals (organisation_id, code, name, journal_type)
  VALUES
    (target_organisation_id, 'GEN', 'Journal général', 'general'),
    (target_organisation_id, 'VEN', 'Journal des ventes', 'sales'),
    (target_organisation_id, 'ACH', 'Journal des achats', 'purchases'),
    (target_organisation_id, 'ENC', 'Journal des encaissements', 'cash_receipts'),
    (target_organisation_id, 'DEC', 'Journal des décaissements', 'cash_disbursements'),
    (target_organisation_id, 'PAI', 'Journal de paie', 'payroll')
  ON CONFLICT (organisation_id, code) DO NOTHING;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;
