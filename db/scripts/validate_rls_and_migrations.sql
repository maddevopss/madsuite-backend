-- ============================================================
-- MADSuite / TimeMonitoring
-- validate_rls_and_migrations.sql
-- Vérification manuelle de la sécurité et de la télémétrie
-- ============================================================

-- 1. Test d'isolation RLS
-- Ce bloc simule une session pour l'organisation 1 et vérifie l'étanchéité
DO $$
BEGIN
  -- On définit le contexte sur l'organisation 1
  PERFORM set_config('app.current_organisation_id', '1', true);
  
  -- La requête ne doit retourner aucune ligne d'une autre organisation
  -- grâce aux politiques créées dans la migration 023.
  IF EXISTS (
    SELECT 1 FROM invoices 
    WHERE organisation_id != 1
  ) THEN
    RAISE WARNING 'RLS FAILURE: Des données cross-org ont été détectées !';
  ELSE
    RAISE NOTICE 'SUCCESS: Le filtrage RLS sur la table "invoices" est actif.';
  END IF;
  
  -- Vérification pour activity_logs (migration 019b)
  IF EXISTS (SELECT 1 FROM activity_logs WHERE organisation_id != 1) THEN
    RAISE WARNING 'RLS FAILURE: activity_logs n''est pas étanche !';
  ELSE
    RAISE NOTICE 'SUCCESS: Le filtrage RLS sur "activity_logs" est actif.';
  END IF;
END;
$$;

-- 2. Consultation de l'historique des déploiements
-- Valide que runMigrations.js alimente bien la nouvelle table de télémétrie
SELECT version, status, duration_ms, executed_at
FROM schema_migrations_executed
ORDER BY executed_at DESC
LIMIT 10;
