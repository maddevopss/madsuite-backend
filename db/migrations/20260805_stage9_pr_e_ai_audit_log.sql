-- Étage 9 PR E — Journal d'audit de l'intelligence (issue #195).
--
-- Journalise chaque invocation réelle du moteur (PR C) une fois le
-- contexte réellement assemblé (donc jamais pour un 403 d'activation —
-- rien n'a été traité). Champs volontairement MINIMISÉS par rapport au
-- contexte complet (PR B) : identifiants et compteurs seulement, jamais
-- le texte des erreurs connues (titre/contournement) — le journal prouve
-- CE QUI S'EST PASSÉ, pas une seconde copie des données métier.
-- decision_human_* reste NULL tant que la PR D (confirmation humaine)
-- n'existe pas ; ce journal est conçu pour qu'elle vienne compléter la
-- même ligne plutôt que d'en créer une seconde. Conservation dérivée du
-- risk_level déclaré au catalogue (PR A) pour le cas d'usage/version
-- réellement utilisé.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  use_case_id TEXT NOT NULL,
  use_case_version TEXT NOT NULL,
  engine_contract TEXT NOT NULL,
  request_context JSONB NOT NULL,
  authorized_context_summary JSONB NOT NULL,
  result_summary JSONB NOT NULL,
  correlation JSONB NOT NULL,
  human_decision TEXT CHECK (human_decision IN ('confirmed','declined')),
  human_decision_by BIGINT,
  human_decision_at TIMESTAMPTZ,
  retention_class TEXT NOT NULL CHECK (retention_class IN ('short','standard','extended')),
  retention_until TIMESTAMPTZ NOT NULL,
  requested_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_log_org_created
  ON ai_audit_log(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_org_use_case
  ON ai_audit_log(organisation_id, use_case_id, created_at DESC);

ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_audit_log_org_isolation ON ai_audit_log;
CREATE POLICY ai_audit_log_org_isolation ON ai_audit_log
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
