-- Index partiel pour booster les performances de l'assistant de facturation "temps réel"
-- Cet index ne contient que les lignes non agrégées, rendant la recherche instantanée.
CREATE INDEX IF NOT EXISTS idx_activity_logs_live_suggestions 
ON activity_logs (organisation_id, utilisateur_id, captured_at) 
WHERE (is_aggregated = false);

-- Analyse de la table pour mettre à jour les statistiques du planificateur
ANALYZE activity_logs;

COMMENT ON INDEX idx_activity_logs_live_suggestions IS 'Optimise le calcul des suggestions en temps réel pour le Billing Assistant.';