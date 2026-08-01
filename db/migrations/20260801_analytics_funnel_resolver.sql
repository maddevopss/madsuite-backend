-- 20260801_analytics_funnel_resolver.sql
-- Le "revenue truth snapshot" inline de GET /api/analytics/funnel compare
-- analytics_events (RLS FORCE) à organisations/invoices (invoices également
-- RLS FORCE) sur une connexion non scopée : les compteurs analytics_* et
-- db_orgs_with_invoices retournaient toujours 0, masquant silencieusement
-- toute dérive réelle entre le suivi analytique et l'état réel de la base.

CREATE OR REPLACE FUNCTION compute_revenue_truth_snapshot()
RETURNS TABLE(
  analytics_subscription_active BIGINT,
  db_pro_orgs BIGINT,
  analytics_first_invoices BIGINT,
  db_orgs_with_invoices BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT organisation_id) FROM analytics_events WHERE event_name = 'subscription_active' AND created_at >= NOW() - INTERVAL '90 days'),
    (SELECT COUNT(*) FROM organisations WHERE plan_type = 'pro' OR subscription_status = 'active'),
    (SELECT COUNT(DISTINCT organisation_id) FROM analytics_events WHERE event_name IN ('first_invoice_created', 'invoice_created') AND created_at >= NOW() - INTERVAL '90 days'),
    (SELECT COUNT(DISTINCT organisation_id) FROM invoices);
$$;

GRANT EXECUTE ON FUNCTION compute_revenue_truth_snapshot() TO PUBLIC;
