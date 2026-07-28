-- Force l'application des politiques RLS au propriétaire des tables.
-- Les superutilisateurs PostgreSQL conservent leur capacité native de contournement;
-- l'application ne doit donc jamais se connecter avec un rôle superutilisateur.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = false
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END;
$$;
