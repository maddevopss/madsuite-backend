-- Table pour stocker les résultats de détection de projet (Cache)
CREATE TABLE IF NOT EXISTS activity_project_cache (
    id SERIAL PRIMARY KEY,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    window_title_hash CHAR(32) NOT NULL, -- MD5 du window_title
    suggested_project_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
    confidence INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index unique pour la recherche rapide
CREATE UNIQUE INDEX idx_activity_cache_lookup ON activity_project_cache (organisation_id, app_name, window_title_hash);

-- Activation du RLS
ALTER TABLE activity_project_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_project_cache_policy ON activity_project_cache
    USING (organisation_id = (current_setting('app.current_organisation_id')::integer));

ANALYZE activity_project_cache;

COMMENT ON TABLE activity_project_cache IS 'Cache des résultats de similarité pour éviter les calculs pg_trgm répétitifs.';