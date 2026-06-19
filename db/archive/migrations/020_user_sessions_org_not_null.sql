-- ============================================================
-- MADSuite / TimeMonitoring
-- 020_user_sessions_org_not_null.sql
-- Sécurité Multi-Tenant: user_sessions doit avoir
-- organisation_id NOT NULL pour isoler les sessions par org
-- ============================================================

-- Ajout colonne + FK vers organisations
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE;

-- Backfill via utilisateur_id -> utilisateurs.organisation_id
UPDATE user_sessions us
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE us.utilisateur_id = u.id
  AND us.organisation_id IS NULL;

-- Contraintes NOT NULL + CHECK
ALTER TABLE user_sessions
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE user_sessions
  ADD CONSTRAINT chk_user_sessions_org_not_null
  CHECK (organisation_id IS NOT NULL);
