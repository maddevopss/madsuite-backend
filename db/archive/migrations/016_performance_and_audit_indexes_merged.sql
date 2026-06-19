-- Migration 016: Fusion Performance & Audit Indexes
-- 1. Nettoyage de l'ancien index d'audit (si existant)
DROP INDEX IF EXISTS idx_audit_logs_org_created;

-- 2. Indexation optimisée pour les logs d'audit métier
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_created 
ON business_audit_logs(organisation_id, action, created_at DESC);

-- 3. Indexes pour accélérer le job de rétention (dataRetention.js)
-- Accélère le DELETE sur activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_retention_lookup 
ON activity_logs (organisation_id, captured_at)
WHERE deleted_at IS NULL;

-- Accélère le DELETE sur activity_daily_summary
CREATE INDEX IF NOT EXISTS idx_activity_summary_retention_lookup 
ON activity_daily_summary (organisation_id, activity_date);

-- Accélère le DELETE sur business_audit_logs
CREATE INDEX IF NOT EXISTS idx_business_audit_logs_retention_lookup 
ON business_audit_logs (organisation_id, created_at);
