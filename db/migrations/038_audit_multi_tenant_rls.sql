-- ============================================================
-- MADSuite / TimeMonitoring
-- 038_audit_multi_tenant_rls.sql
-- Extension de la Row-Level Security (RLS) aux nouvelles tables
-- ============================================================

DO $$
DECLARE
    t TEXT;
    -- Liste de toutes les tables récentes qui n'avaient pas encore RLS
    tables TEXT[] := ARRAY[
        'estimates', 
        'estimate_items',
        'expenses', 
        'billing_reminders', 
        'project_budgets', 
        'stripe_subscriptions', 
        'calendar_sync_settings', 
        'client_portal_settings', 
        'interac_settings', 
        'invoice_payments', 
        'timesheet_approvals', 
        'smart_billing_rules', 
        'estimate_signatures'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        -- Vérifie si la table existe avant d'appliquer la politique pour éviter les erreurs
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            
            -- Suppression préventive pour éviter les erreurs de duplication au rejeu
            EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
            
            -- Création de la politique RLS basée sur le contexte de session 'app.current_organisation_id'
            EXECUTE format('CREATE POLICY %I_org_isolation ON %I
                USING (organisation_id = current_setting(''app.current_organisation_id'')::integer)
                WITH CHECK (organisation_id = current_setting(''app.current_organisation_id'')::integer)', t, t);
        END IF;
    END LOOP;
END $$;
