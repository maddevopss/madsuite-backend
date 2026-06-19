-- Migration 010: indexes de securite/performance et garde-fous organisation.

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_user_time
ON activity_logs(organisation_id, utilisateur_id, captured_at);

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_user_time_active
ON activity_logs(organisation_id, utilisateur_id, captured_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
ON user_sessions(active)
WHERE active = true;

-- NOTE:
-- La contrainte organisation_id obligatoire de time_entries est geree dans
-- 012_organisation_id_not_null_and_constraints.sql.
-- Ne pas l'ajouter ici, sinon les migrations dev/E2E rejouees peuvent planter
-- avec duplicate_object / MergeWithExistingConstraint.
