-- Activation de l'extension pour la recherche floue (Fuzzy Search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index GIN sur le nom des projets pour accélérer l'opérateur de similarité '%'
-- L'indexation utilise gin_trgm_ops pour supporter les trigrammes
CREATE INDEX IF NOT EXISTS idx_projets_nom_trgm 
ON projets USING gin (nom gin_trgm_ops);

ANALYZE projets;

COMMENT ON INDEX idx_projets_nom_trgm IS 'Optimise la détection automatique de projets via Billing Assistant.';