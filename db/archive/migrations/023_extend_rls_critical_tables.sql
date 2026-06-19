-- ============================================================
-- MADSuite / TimeMonitoring
-- 023_extend_rls_critical_tables.sql
-- Extension de la Row-Level Security (RLS) à toutes les tables critiques
-- ============================================================

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'invoices', 'invoice_items', 'time_entries', 'utilisateurs', 'clients', 
        'projets', 'activity_patterns', 'activity_app_rules', 'activity_context_rules', 
        'user_sessions', 'daily_summaries', 'activity_daily_summary'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        -- Suppression préventive pour éviter les erreurs de duplication au rejeu
        EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
        EXECUTE format('CREATE POLICY %I_org_isolation ON %I
            USING (organisation_id = current_setting(''app.current_organisation_id'')::integer)
            WITH CHECK (organisation_id = current_setting(''app.current_organisation_id'')::integer)', t, t);
    END LOOP;
END $$;
