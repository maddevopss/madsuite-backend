-- ============================================================
-- MADSuite / TimeMonitoring
-- validate_rls_and_migrations.sql
-- Vérification manuelle de la sécurité et de la télémétrie
-- ============================================================

-- 1. Test d'isolation RLS
DO $$
BEGIN
  PERFORM set_config('app.current_organisation_id', '1', true);

  IF EXISTS (SELECT 1 FROM invoices WHERE organisation_id != 1) THEN
    RAISE WARNING 'RLS FAILURE: Des données cross-org ont été détectées !';
  ELSE
    RAISE NOTICE 'SUCCESS: Le filtrage RLS sur la table invoices est actif.';
  END IF;

  IF EXISTS (SELECT 1 FROM activity_logs WHERE organisation_id != 1) THEN
    RAISE WARNING 'RLS FAILURE: activity_logs n''est pas étanche !';
  ELSE
    RAISE NOTICE 'SUCCESS: Le filtrage RLS sur activity_logs est actif.';
  END IF;
END;
$$;

-- 2. Vérification FORCE ROW LEVEL SECURITY
DO $$
DECLARE
  unforced_tables text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
  INTO unforced_tables
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relrowsecurity = true
    AND c.relforcerowsecurity = false;

  IF unforced_tables IS NOT NULL THEN
    RAISE WARNING 'RLS FORCE MISSING: %', unforced_tables;
  ELSE
    RAISE NOTICE 'SUCCESS: toutes les tables publiques avec RLS utilisent FORCE ROW LEVEL SECURITY.';
  END IF;
END;
$$;

-- 3. Historique des déploiements
SELECT version, status, duration_ms, executed_at
FROM schema_migrations_executed
ORDER BY executed_at DESC
LIMIT 10;
