-- 20260801_weekly_report_admins_resolver.sql
-- weeklyReport.js liste les admins de TOUTES les organisations (job cron en
-- lot, cross-tenant par nature) en joignant utilisateurs, sous RLS FORCE.
-- Sans contexte d'organisation, cette jointure retournait toujours 0 ligne :
-- le job ne trouvait jamais aucun admin et n'a donc jamais envoyé le moindre
-- rapport hebdomadaire. Fonction SECURITY DEFINER étroite, même requête que
-- l'originale, résolution cross-tenant explicite plutôt qu'une lecture
-- directe bloquée par RLS.

CREATE OR REPLACE FUNCTION list_all_org_admins()
RETURNS TABLE(
  org_id INTEGER,
  org_nom VARCHAR,
  admin_email VARCHAR
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.nom, u.email
  FROM organisations o
  JOIN utilisateurs u ON u.organisation_id = o.id
  WHERE u.role = 'admin' AND u.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION list_all_org_admins() TO PUBLIC;
