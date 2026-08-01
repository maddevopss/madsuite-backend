-- Domaine 1.I (taxes avancées), deuxième micro-bloc : périodes fiscales et
-- rapport de remise. Une période fiscale est distincte d'une période
-- comptable (accounting_periods) : une remise TPS/TVQ trimestrielle peut
-- couvrir plusieurs périodes comptables mensuelles. Le rapport de remise
-- (montants collectés/récupérables par profil de taxe, net à remettre)
-- n'est jamais recalculé silencieusement après le dépôt ("filed") — le
-- résultat est figé en instantané, toute correction ultérieure passe par
-- une période fiscale suivante distincte, jamais par une réécriture de
-- l'historique.

BEGIN;

CREATE TABLE IF NOT EXISTS tax_filing_periods (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  frequency VARCHAR(16) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filed')),
  net_amount NUMERIC(14,2),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  filed_at TIMESTAMPTZ,
  filed_by INTEGER REFERENCES utilisateurs(id),
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_tax_filing_periods_dates ON tax_filing_periods (organisation_id, period_start, period_end);

ALTER TABLE tax_filing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_filing_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_filing_periods_org ON tax_filing_periods
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
