-- Migration 017 : Index partiel pour le nettoyage des données soft-deleted

-- Cet index ne pèsera presque rien car il n'inclut que les lignes où deleted_at est présent.
-- Idéal pour accélérer : DELETE FROM activity_logs WHERE deleted_at IS NOT NULL AND ...
CREATE INDEX IF NOT EXISTS idx_activity_logs_deleted_cleanup
ON activity_logs (organisation_id, deleted_at)
WHERE deleted_at IS NOT NULL;

-- Application du même principe pour les entrées de temps
CREATE INDEX IF NOT EXISTS idx_time_entries_deleted_cleanup
ON time_entries (organisation_id, deleted_at)
WHERE deleted_at IS NOT NULL;