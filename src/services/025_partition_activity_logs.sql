-- 1. Renommer l'ancienne table pour migration
ALTER TABLE activity_logs RENAME TO activity_logs_old;

-- 2. Créer la nouvelle table parente partitionnée
CREATE TABLE activity_logs (
    id SERIAL,
    utilisateur_id INTEGER NOT NULL,
    app_name VARCHAR(255),
    window_title TEXT,
    is_idle BOOLEAN DEFAULT FALSE,
    idle_seconds INTEGER DEFAULT 0,
    type VARCHAR(20) NOT NULL DEFAULT 'active',
    duration_seconds INTEGER,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    organisation_id INTEGER NOT NULL,
    is_aggregated BOOLEAN DEFAULT FALSE,
    -- La clé de partition doit être incluse dans toute contrainte unique/primaire
    PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

-- 3. Création des premières partitions (Exemple pour Janvier/Février 2024)
CREATE TABLE activity_logs_y2024m01 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE activity_logs_y2024m02 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- 4. Migration des données existantes (à faire hors pic d'activité)
INSERT INTO activity_logs (utilisateur_id, app_name, window_title, is_idle, idle_seconds, type, duration_seconds, captured_at, organisation_id, is_aggregated)
SELECT utilisateur_id, app_name, window_title, is_idle, idle_seconds, type, duration_seconds, captured_at, organisation_id, is_aggregated
FROM activity_logs_old;

-- 5. Recréer les index sur la table parente (ils seront propagés)
CREATE INDEX idx_activity_logs_captured_at ON activity_logs (captured_at);
CREATE INDEX idx_activity_logs_org_id ON activity_logs (organisation_id);