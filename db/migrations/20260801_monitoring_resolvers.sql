-- 20260801_monitoring_resolvers.sql
-- checkLongRunningTimers.js, metricsAggregationJob.js et jobResultAggregator.js
-- lisent/écrivent intentionnellement à l'échelle de la plateforme (monitoring
-- cross-tenant, tableau de bord super-admin, alertes système), hors de tout
-- contexte d'organisation. time_entries/analytics_events/utilisateurs sont
-- sous RLS FORCE : ces requêtes retournaient toujours 0 ligne sur une
-- connexion non scopée — timers bloqués jamais détectés, dashboard funnel
-- toujours à zéro, alertes admin jamais envoyées.
--
-- Fonctions SECURITY DEFINER étroites, mêmes requêtes que l'original.

CREATE OR REPLACE FUNCTION check_long_running_timers(p_threshold_hours NUMERIC)
RETURNS TABLE(
  id INTEGER,
  organisation_id INTEGER,
  utilisateur_id INTEGER,
  projet_id INTEGER,
  start_time TIMESTAMPTZ,
  utilisateur_email VARCHAR,
  projet_nom VARCHAR,
  client_nom VARCHAR,
  duration_hours NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    te.id,
    te.organisation_id,
    te.utilisateur_id,
    te.projet_id,
    te.start_time,
    u.email AS utilisateur_email,
    p.nom AS projet_nom,
    c.nom AS client_nom,
    ROUND(EXTRACT(EPOCH FROM (NOW() - te.start_time)) / 3600, 2) AS duration_hours
  FROM time_entries te
  JOIN projets p
    ON p.id = te.projet_id
    AND p.organisation_id = te.organisation_id
  JOIN clients c
    ON c.id = p.client_id
    AND c.organisation_id = te.organisation_id
  LEFT JOIN utilisateurs u
    ON u.id = te.utilisateur_id
    AND u.organisation_id = te.organisation_id
  WHERE te.end_time IS NULL
    AND te.organisation_id IS NOT NULL
    AND te.start_time <= NOW() - (p_threshold_hours * INTERVAL '1 hour')
  ORDER BY te.start_time ASC;
$$;

GRANT EXECUTE ON FUNCTION check_long_running_timers(NUMERIC) TO PUBLIC;

CREATE OR REPLACE FUNCTION compute_platform_funnel_counts(p_days INTEGER)
RETURNS TABLE(
  signups BIGINT,
  onboarding_completed BIGINT,
  first_invoice BIGINT,
  checkout_started BIGINT,
  subscription_active BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_events AS (
    SELECT organisation_id, event_name
    FROM analytics_events
    WHERE created_at >= NOW() - INTERVAL '1 day' * p_days
  )
  SELECT
    COUNT(*) FILTER (WHERE event_name = 'signup_completed') AS signups,
    COUNT(*) FILTER (WHERE event_name = 'onboarding_completed') AS onboarding_completed,
    COUNT(*) FILTER (WHERE event_name IN ('first_invoice_created', 'invoice_created')) AS first_invoice,
    COUNT(*) FILTER (WHERE event_name = 'checkout_started') AS checkout_started,
    COUNT(*) FILTER (WHERE event_name = 'subscription_active') AS subscription_active
  FROM recent_events;
$$;

GRANT EXECUTE ON FUNCTION compute_platform_funnel_counts(INTEGER) TO PUBLIC;

CREATE OR REPLACE FUNCTION compute_time_to_first_invoice(p_days INTEGER)
RETURNS TABLE(avg_minutes NUMERIC, sample_size BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(AVG(EXTRACT(EPOCH FROM (fi.first_invoice - sc.signup)) / 60), 0) AS avg_minutes,
    COUNT(*) AS sample_size
  FROM (
    SELECT organisation_id, MIN(created_at) AS signup
    FROM analytics_events
    WHERE event_name = 'signup_completed'
      AND created_at >= NOW() - INTERVAL '1 day' * p_days
    GROUP BY organisation_id
  ) sc
  JOIN (
    SELECT organisation_id, MIN(created_at) AS first_invoice
    FROM analytics_events
    WHERE event_name IN ('first_invoice_created', 'invoice_created')
      AND created_at >= NOW() - INTERVAL '1 day' * p_days
    GROUP BY organisation_id
  ) fi USING (organisation_id);
$$;

GRANT EXECUTE ON FUNCTION compute_time_to_first_invoice(INTEGER) TO PUBLIC;

-- notify_all_admins_system_alert : notifications n'est pas sous RLS, mais la
-- résolution des admins (utilisateurs, RLS FORCE) l'est. La fonction fait
-- l'INSERT ... SELECT en interne pour rester une opération atomique unique,
-- strictement équivalente à l'INSERT ... SELECT original.
CREATE OR REPLACE FUNCTION notify_all_admins_system_alert(p_message TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
  SELECT organisation_id, id, 'system_alert', p_message FROM utilisateurs WHERE role = 'admin';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_all_admins_system_alert(TEXT) TO PUBLIC;
