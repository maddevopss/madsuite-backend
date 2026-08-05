-- Étage 9 PR A — Registre des cas d'usage assistés (issue #195).
--
-- Constat préalable : seule une version en mémoire, non persistée,
-- existait sur main (src/ai/assistedUseCaseRegistry.js, jamais montée
-- sur une route). Le critère de fermeture de l'Étage 9 exige d'empêcher
-- « l'activation implicite d'une fonction non approuvée » — impossible à
-- garantir sans état persisté par organisation : une constante en
-- mémoire ne peut pas enregistrer QUI a activé QUOI, à quel moment, pour
-- quelle organisation.
--
-- ai_use_cases : catalogue plateforme (pas par organisation — au même
-- titre que le registre MODULES de src/config/modules.js) des cas
-- d'usage déclarés, versionnés, avec propriétaire/risque/autonomie/
-- classes de données. Écrit uniquement par un super-admin plateforme
-- (voir requireSuperAdmin), jamais par un admin d'organisation.
--
-- ai_use_case_activations : décision explicite, par organisation, d'un
-- admin d'organisation d'activer un cas d'usage du catalogue — mais
-- UNIQUEMENT si son statut catalogue est 'approved' (contrainte
-- applicative dans la route, pas en base, car dépend d'une jointure).

BEGIN;

CREATE TABLE IF NOT EXISTS ai_use_cases (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved','experimental','forbidden')),
  autonomy TEXT NOT NULL CHECK (autonomy IN ('advisory','draft_only')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  data_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS ai_use_case_activations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  use_case_id TEXT NOT NULL,
  use_case_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  activated_by BIGINT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_by BIGINT,
  disabled_at TIMESTAMPTZ,
  FOREIGN KEY (use_case_id, use_case_version) REFERENCES ai_use_cases(id, version),
  UNIQUE (organisation_id, use_case_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_use_case_activations_org_status
  ON ai_use_case_activations(organisation_id, status);

ALTER TABLE ai_use_case_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_use_case_activations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_use_case_activations_org_isolation ON ai_use_case_activations;
CREATE POLICY ai_use_case_activations_org_isolation ON ai_use_case_activations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
