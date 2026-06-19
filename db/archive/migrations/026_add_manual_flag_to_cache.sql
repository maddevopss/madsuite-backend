-- Ajout du flag is_manual pour prioriser les corrections utilisateurs
ALTER TABLE activity_project_cache ADD COLUMN is_manual BOOLEAN DEFAULT FALSE;

-- Index pour accélérer la priorité
CREATE INDEX idx_activity_cache_manual ON activity_project_cache (organisation_id, is_manual) WHERE is_manual = TRUE;

COMMENT ON COLUMN activity_project_cache.is_manual IS 'Si TRUE, cette entrée provient d''une validation manuelle et outrepasse l''IA.';