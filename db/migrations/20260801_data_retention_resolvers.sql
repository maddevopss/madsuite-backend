-- 20260801_data_retention_resolvers.sql
-- dataRetention.js (purge RGPD/rétention quotidienne, 3h du matin) opère
-- intentionnellement sur TOUTES les organisations en une seule transaction,
-- via une connexion non scopée (db.pool.connect() sans set_config). Mais
-- activity_logs, activity_daily_summary, time_entries, projets, clients,
-- utilisateurs, invoices, user_sessions, security_incidents_buffer et
-- activity_project_cache sont tous sous RLS FORCE : chaque DELETE
-- retournait toujours 0 ligne affectée — ces purges n'ont jamais
-- physiquement supprimé la moindre donnée depuis toujours (seuls
-- business_audit_logs et refresh_tokens, non RLS, étaient réellement purgés).
--
-- Fonctions SECURITY DEFINER étroites, mêmes requêtes et mêmes bornes de
-- rétention que l'original — jamais un accès arbitraire. Chaque fonction
-- ne fait QUE le DELETE déjà présent dans le job, rien de plus.

CREATE OR REPLACE FUNCTION purge_activity_logs_batch(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM activity_logs
    WHERE id IN (
      SELECT al.id FROM activity_logs al
      JOIN organisations o ON al.organisation_id = o.id
      WHERE al.captured_at < NOW() - (o.retention_activity_logs_days * INTERVAL '1 day')
        AND al.is_aggregated = true
      LIMIT p_limit
    )
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION purge_activity_logs_batch(INTEGER) TO PUBLIC;

CREATE OR REPLACE FUNCTION purge_activity_summary_batch(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM activity_daily_summary
    WHERE id IN (
      SELECT ads.id FROM activity_daily_summary ads
      JOIN organisations o ON ads.organisation_id = o.id
      WHERE ads.activity_date < CURRENT_DATE - (o.retention_summary_days * INTERVAL '1 day')
      LIMIT p_limit
    )
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION purge_activity_summary_batch(INTEGER) TO PUBLIC;

-- p_table_name est toujours une valeur fixe fournie par l'application
-- (jamais une entrée utilisateur) parmi une liste connue de tables
-- soft-delete ; quote_ident() via %I protège quand même contre toute
-- injection.
CREATE OR REPLACE FUNCTION purge_soft_deleted_batch(p_table_name TEXT, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  EXECUTE format(
    'DELETE FROM %I WHERE id IN (SELECT id FROM %I WHERE deleted_at < NOW() - INTERVAL ''90 days'' LIMIT $1)',
    p_table_name, p_table_name
  ) USING p_limit;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_soft_deleted_batch(TEXT, INTEGER) TO PUBLIC;

CREATE OR REPLACE FUNCTION purge_user_sessions_batch(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM user_sessions
    WHERE id IN (SELECT id FROM user_sessions WHERE login_time < NOW() - INTERVAL '90 days' LIMIT p_limit)
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION purge_user_sessions_batch(INTEGER) TO PUBLIC;

CREATE OR REPLACE FUNCTION purge_security_incidents_buffer_batch(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM security_incidents_buffer
    WHERE id IN (
      SELECT id FROM security_incidents_buffer
      WHERE (notified_at < NOW() - INTERVAL '30 days')
         OR (created_at < NOW() - INTERVAL '90 days')
      LIMIT p_limit
    )
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION purge_security_incidents_buffer_batch(INTEGER) TO PUBLIC;

CREATE OR REPLACE FUNCTION purge_activity_project_cache_batch()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM activity_project_cache
    WHERE last_used_at < NOW() - INTERVAL '60 days'
       OR (confidence < 30 AND is_manual = FALSE AND last_used_at < NOW() - INTERVAL '7 days')
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION purge_activity_project_cache_batch() TO PUBLIC;
