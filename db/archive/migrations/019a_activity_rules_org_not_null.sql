-- ============================================================
-- MADSuite / TimeMonitoring
-- 019a_activity_rules_org_not_null.sql
-- Sécurité Multi-Tenant: activity_* tables doivent avoir
-- organisation_id NOT NULL pour empêcher les fuites cross-org
-- ============================================================

-- Preflight: backfill NULL org_id avant d'ajouter NOT NULL
-- On rattache aux projets via laFK projet_id -> client -> org

-- activity_patterns: backfill via projet_id -> client -> organisation
UPDATE activity_patterns ap
SET organisation_id = p.organisation_id
FROM projets p
WHERE ap.projet_id = p.id
  AND ap.organisation_id IS NULL;

-- activity_app_rules: backfill via created_by -> utilisateur -> organisation
UPDATE activity_app_rules aar
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE aar.created_by = u.id
  AND aar.organisation_id IS NULL;

-- activity_context_rules: pas de FK directe, on ne peut pasbacker --
-- ces enregistrements doivent être supprimés ou assignés manuellement
-- (ticket à traiter avant migration si des NULL existent)

-- application des contraintes NOT NULL + CHECK

ALTER TABLE activity_patterns
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE activity_patterns
  ADD CONSTRAINT chk_activity_patterns_org_not_null
  CHECK (organisation_id IS NOT NULL);

ALTER TABLE activity_app_rules
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE activity_app_rules
  ADD CONSTRAINT chk_activity_app_rules_org_not_null
  CHECK (organisation_id IS NOT NULL);

ALTER TABLE activity_context_rules
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE activity_context_rules
  ADD CONSTRAINT chk_activity_context_rules_org_not_null
  CHECK (organisation_id IS NOT NULL);