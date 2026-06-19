-- Activation du RLS pour les tables critiques
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY organisation_isolation_policy ON activity_logs
    USING (organisation_id = current_setting('app.current_organisation_id')::integer);
-- Cette politique force PostgreSQL à filtrer les données, même si le développeur oublie le WHERE.