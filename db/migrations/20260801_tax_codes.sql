-- Domaine 1.I (taxes avancées), premier micro-bloc : registre de profils
-- de taxes versionnés et datés. Jusqu'ici, les taux de taxe n'existaient
-- que sous forme de champs numériques libres (tax_rate sur les lignes de
-- facture/soumission fournisseur), sans registre gouverné ni compte
-- comptable associé — chaque taux devait être ressaisi manuellement à
-- chaque document, sans traçabilité de la règle appliquée. Ce registre
-- suit le même modèle déjà éprouvé pour payroll_rulesets : versionné,
-- daté, un seul profil actif par code à la fois (contrainte d'unicité
-- partielle), jamais codé en dur comme une vérité permanente.

BEGIN;

CREATE TABLE IF NOT EXISTS tax_codes (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  rate NUMERIC(8,6) NOT NULL CHECK (rate >= 0 AND rate < 1),
  tax_type VARCHAR(16) NOT NULL CHECK (tax_type IN ('collected', 'recoverable')),
  account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  activated_by INTEGER REFERENCES utilisateurs(id),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, code, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_codes_one_active_per_code
  ON tax_codes (organisation_id, code)
  WHERE status = 'active';

ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_codes_org ON tax_codes
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
