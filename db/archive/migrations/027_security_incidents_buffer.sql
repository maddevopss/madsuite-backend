-- ============================================================
-- MADSuite / TimeMonitoring
-- 027_security_incidents_buffer.sql
-- Création de la table tampon pour la consolidation des alertes
-- ============================================================

CREATE TABLE IF NOT EXISTS security_incidents_buffer (
    id SERIAL PRIMARY KEY,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- ex: 'TOKEN_REUSE_DETECTED'
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMPTZ -- NULL tant que l'email de synthèse n'est pas envoyé
);

-- 1. Index partiel CRITIQUE pour la performance du job de consolidation.
-- On n'indexe que les lignes non traitées pour garder un index minuscule et ultra-rapide.
CREATE INDEX IF NOT EXISTS idx_security_buffer_not_notified 
ON security_incidents_buffer (utilisateur_id) 
WHERE notified_at IS NULL;

-- 2. Index de maintenance pour la purge (dataRetention)
CREATE INDEX IF NOT EXISTS idx_security_buffer_purge 
ON security_incidents_buffer (organisation_id, created_at);

-- 3. Activation de la Row-Level Security (RLS)
ALTER TABLE security_incidents_buffer ENABLE ROW LEVEL SECURITY;

CREATE POLICY security_incidents_buffer_isolation ON security_incidents_buffer
    USING (organisation_id = current_setting('app.current_organisation_id')::integer)
    WITH CHECK (organisation_id = current_setting('app.current_organisation_id')::integer);

COMMENT ON TABLE security_incidents_buffer IS 'Stockage temporaire des alertes de sécurité pour envoi groupé.';
COMMENT ON COLUMN security_incidents_buffer.notified_at IS 'Horodatage de l''envoi du résumé par email. NULL = en attente.';