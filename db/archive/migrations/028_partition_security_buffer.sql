-- ============================================================
-- 028_partition_security_buffer.sql
-- Transformation de security_incidents_buffer en table partitionnée
-- ============================================================

BEGIN;

-- 1. Renommer l'ancienne table pour backup/migration
ALTER TABLE security_incidents_buffer RENAME TO security_incidents_buffer_old;
DROP INDEX IF EXISTS idx_security_buffer_not_notified;
DROP INDEX IF EXISTS idx_security_buffer_purge;

-- 2. Créer la table parente partitionnée par plage (RANGE) sur created_at
CREATE TABLE security_incidents_buffer (
    id SERIAL,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMPTZ,
    PRIMARY KEY (id, created_at) -- created_at doit être dans la PK pour le partitionnement
) PARTITION BY RANGE (created_at);

-- 3. Créer les premières partitions (ex: Juin et Juillet 2026)
CREATE TABLE security_incidents_buffer_y2026m06 PARTITION OF security_incidents_buffer
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE security_incidents_buffer_y2026m07 PARTITION OF security_incidents_buffer
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- 4. Recréer les index (ils seront automatiquement créés sur les partitions)
CREATE INDEX idx_security_buffer_not_notified 
ON security_incidents_buffer (utilisateur_id) 
WHERE notified_at IS NULL;

-- 5. Rétablir la RLS
ALTER TABLE security_incidents_buffer ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_incidents_buffer_isolation ON security_incidents_buffer
    USING (organisation_id = current_setting('app.current_organisation_id')::integer);

-- 6. Optionnel : Migrer les données des 30 derniers jours
INSERT INTO security_incidents_buffer (organisation_id, utilisateur_id, type, details, created_at, notified_at)
SELECT organisation_id, utilisateur_id, type, details, created_at, notified_at 
FROM security_incidents_buffer_old
WHERE created_at > NOW() - INTERVAL '30 days';

-- 7. Nettoyage (après vérification, tu pourras supprimer security_incidents_buffer_old)
-- DROP TABLE security_incidents_buffer_old;

COMMIT;