-- 20260731_fix_utilisateurs_rls_missing_ok.sql
-- Corrige un ensemble de policies RLS qui appellent
-- current_setting('app.current_organisation_id') SANS missing_ok=true : toute requête
-- sur ces tables échoue avec "unrecognized configuration parameter" tant que la session
-- n'a jamais fixé ce GUC (ex. le tout premier accès sur une connexion neuve), au lieu
-- de simplement filtrer 0 ligne comme le reste des policies du projet
-- (motif NULLIF(current_setting(..., true), '')::INT déjà utilisé partout ailleurs).

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='utilisateurs') THEN
    DROP POLICY IF EXISTS utilisateurs_rls ON utilisateurs;

    CREATE POLICY utilisateurs_rls ON utilisateurs
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='password_reset_tokens') THEN
    DROP POLICY IF EXISTS password_reset_tokens_rls ON password_reset_tokens;

    CREATE POLICY password_reset_tokens_rls ON password_reset_tokens
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT);
  END IF;
END $$;

-- Même défaut dans 059_cognitive_rls_safeguard.sql (4 policies).
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='cognitive_enablement') THEN
    DROP POLICY IF EXISTS cognitive_enablement_rls ON cognitive_enablement;
    CREATE POLICY cognitive_enablement_rls ON cognitive_enablement
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT);
  END IF;

  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='cognitive_models') THEN
    DROP POLICY IF EXISTS cognitive_models_rls ON cognitive_models;
    CREATE POLICY cognitive_models_rls ON cognitive_models
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT);
  END IF;

  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='cognitive_state_events') THEN
    DROP POLICY IF EXISTS cognitive_state_events_rls ON cognitive_state_events;
    CREATE POLICY cognitive_state_events_rls ON cognitive_state_events
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT);
  END IF;

  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='daily_cognitive_metrics') THEN
    DROP POLICY IF EXISTS daily_cognitive_metrics_rls ON daily_cognitive_metrics;
    CREATE POLICY daily_cognitive_metrics_rls ON daily_cognitive_metrics
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INT);
  END IF;
END $$;

-- Même défaut dans db/archive/migrations/023_extend_rls_critical_tables.sql
-- (`{table}_org_isolation`, 12 tables dont utilisateurs, invoices, clients, time_entries,
-- user_sessions -- des tables touchées par toute requête pré-contexte, ex. le signup).
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
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
      EXECUTE format('CREATE POLICY %I_org_isolation ON %I
          USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::integer)
          WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::integer)', t, t);
    END IF;
  END LOOP;
END $$;

-- Même défaut dans db/archive/migrations/019b_enable_rls.sql (activity_logs).
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='activity_logs') THEN
    DROP POLICY IF EXISTS organisation_isolation_policy ON activity_logs;
    CREATE POLICY organisation_isolation_policy ON activity_logs
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer);
  END IF;
END $$;

-- Même défaut dans db/archive/migrations/025_add_activity_project_cache.sql.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='activity_project_cache') THEN
    DROP POLICY IF EXISTS activity_project_cache_policy ON activity_project_cache;
    CREATE POLICY activity_project_cache_policy ON activity_project_cache
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer);
  END IF;
END $$;

-- Même défaut dans db/archive/migrations/028_partition_security_buffer.sql
-- (028 remplace 027, même nom de policy).
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='security_incidents_buffer') THEN
    DROP POLICY IF EXISTS security_incidents_buffer_isolation ON security_incidents_buffer;
    CREATE POLICY security_incidents_buffer_isolation ON security_incidents_buffer
      USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer);
  END IF;
END $$;

-- Même défaut dans db/migrations/038_audit_multi_tenant_rls.sql (`{table}_org_isolation`,
-- 13 tables : estimates, expenses, billing_reminders, stripe_subscriptions, etc.).
DO $$
DECLARE
  t TEXT;
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
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
      EXECUTE format('CREATE POLICY %I_org_isolation ON %I
          USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::integer)
          WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::integer)', t, t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- Bootstrap d'authentification cross-tenant (login par email, refresh par id).
--
-- Constat : utilisateurs_rls / utilisateurs_org_isolation exigent
-- organisation_id = app.current_organisation_id. Or au moment du login (recherche
-- par email) et du refresh de session (recherche par id), l'organisation de
-- l'utilisateur est précisément ce qu'on cherche à découvrir : le GUC ne peut pas
-- être positionné à l'avance. Sous RLS strictement appliqué (rôle applicatif sans
-- BYPASSRLS, cf. db.js assertRoleNotSuperuser), ces recherches ne retournaient donc
-- JAMAIS aucune ligne — bloquant tout login et tout refresh de session en pratique.
--
-- Fonctions SECURITY DEFINER, volontairement étroites (2 colonnes de recherche
-- seulement, aucune autre table), possédées par un rôle qui a nativement le
-- privilège de contourner RLS (le propriétaire de la table), pour ne PAS avoir à
-- accorder BYPASSRLS au rôle applicatif lui-même (ce que le démarrage du serveur
-- refuse explicitement et à raison).
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email TEXT)
RETURNS TABLE(
  id INTEGER,
  nom VARCHAR,
  email VARCHAR,
  mot_de_passe VARCHAR,
  role VARCHAR,
  organisation_id INTEGER,
  deleted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, nom, email, mot_de_passe, role, organisation_id, deleted_at
  FROM utilisateurs
  WHERE email = p_email
    AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION auth_find_user_by_id(p_id INTEGER)
RETURNS TABLE(
  id INTEGER,
  nom VARCHAR,
  email VARCHAR,
  role VARCHAR,
  organisation_id INTEGER,
  deleted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, nom, email, role, organisation_id, deleted_at
  FROM utilisateurs
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION auth_find_user_by_email(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_id(INTEGER) TO PUBLIC;
