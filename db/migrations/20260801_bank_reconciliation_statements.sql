-- Domaine 1.G (rapprochement bancaire) : modèle de relevé bancaire et de
-- ses lignes, avec correspondance optionnelle vers une ligne d'écriture
-- comptable du grand livre. accounting-reconciliation.service.js existant
-- rapproche des documents métier (factures, paiements...) à leur écriture
-- comptable ; ce domaine est différent — il rapproche un relevé bancaire
-- externe aux mouvements déjà comptabilisés sur un compte de trésorerie.

BEGIN;

CREATE TABLE IF NOT EXISTS bank_statements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC(14,2) NOT NULL,
  closing_balance NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled', 'locked')),
  locked_at TIMESTAMPTZ,
  locked_by INTEGER REFERENCES utilisateurs(id),
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  statement_id BIGINT NOT NULL,
  line_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL, -- positif = dépôt, négatif = retrait
  external_reference VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'ignored')),
  matched_entry_line_id BIGINT REFERENCES accounting_entry_lines(id),
  matched_at TIMESTAMPTZ,
  matched_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, matched_entry_line_id),
  FOREIGN KEY (organisation_id, statement_id) REFERENCES bank_statements (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_statement ON bank_statement_lines (organisation_id, statement_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_status ON bank_statement_lines (organisation_id, status);

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_statements_org ON bank_statements
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_statement_lines_org ON bank_statement_lines
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
