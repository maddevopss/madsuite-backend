-- ============================================================
-- MADSuite / TimeMonitoring
-- 021_performance_org_listings_indexes.sql
-- Performance: indexes pour listings par organisation
-- (5 indexes pour requêtes Multi-Tenant)
-- ============================================================

-- Utilisateurs: listing actif par org
CREATE INDEX IF NOT EXISTS idx_utilisateurs_org_deleted
ON utilisateurs(organisation_id, deleted_at)
WHERE deleted_at IS NULL;

-- Clients: listing actif par org
CREATE INDEX IF NOT EXISTS idx_clients_org_deleted
ON clients(organisation_id, deleted_at)
WHERE deleted_at IS NULL;

-- Projets: listing par org
CREATE INDEX IF NOT EXISTS idx_projets_org_id
ON projets(organisation_id);

-- Activity logs: listing par org
CREATE INDEX IF NOT EXISTS idx_activity_logs_org_id
ON activity_logs(organisation_id);

-- Time entries: facturation/rapports par org et date
CREATE INDEX IF NOT EXISTS idx_time_entries_org_start
ON time_entries(organisation_id, start_time);