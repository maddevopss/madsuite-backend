-- ============================================================
-- 043_activity_request_id.sql
-- Traceabilité: ajouter request_id aux activity_logs
-- ============================================================

-- Colonne
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS request_id UUID;

-- Index pour requêtes par request_id
CREATE INDEX IF NOT EXISTS idx_activity_logs_request_id
  ON activity_logs(request_id);

