-- Migration 018 : Ajout du flag d'agrégation pour optimiser la purge

ALTER TABLE activity_logs 
ADD COLUMN IF NOT EXISTS is_aggregated BOOLEAN DEFAULT FALSE;

-- Index partiel pour accélérer la purge des données déjà agrégées
CREATE INDEX IF NOT EXISTS idx_activity_logs_purge_ready
ON activity_logs (organisation_id, captured_at)
WHERE is_aggregated = TRUE;

COMMENT ON COLUMN activity_logs.is_aggregated IS 'Indique si le log a été inclus dans le résumé quotidien (activity_daily_summary)';