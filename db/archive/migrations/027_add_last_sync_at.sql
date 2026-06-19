-- Ajout de la colonne de synchronisation
ALTER TABLE utilisateurs 
ADD COLUMN last_sync_at TIMESTAMPTZ;

-- Index optimisé pour le listing Admin (Multi-tenant + Tri)
CREATE INDEX idx_utilisateurs_org_sync 
ON utilisateurs (organisation_id, last_sync_at DESC)
WHERE deleted_at IS NULL;

COMMENT ON COLUMN utilisateurs.last_sync_at IS 'Date de dernière réception de logs de l''agent desktop';