-- 20260801_system_reconciliation_resolvers.sql
-- systemReconciliationJob.js ("Audit Oracle") est le moteur de réconciliation
-- financière plateforme : facture -> paiement Stripe -> ledger -> cohérence
-- analytique, en lot sur TOUTES les organisations. Toutes ses requêtes
-- passent par pool.query() (connexion non scopée), et invoices/analytics_events
-- sont sous RLS FORCE :
--   - Les checks 1 à 4 (LEDGER_IMBALANCE, WEBHOOK_MISMATCH, DATA_DRIFT,
--     PAYMENT_STATE_DRIFT) filtrent sur invoices : toujours 0 ligne, donc
--     ce moteur ne détecte JAMAIS de dérive financière réelle, quelle que
--     soit la réalité des paiements Stripe non propagés ou des ledgers
--     déséquilibrés — un score de 100/100 en permanence.
--   - Le check 5 (REVENUE_SUBSCRIPTION_TRUTH_DRIFT) compare analytics_events
--     (bloqué, toujours 0) à organisations (non bloqué, compte réel) :
--     l'inverse se produit — une fausse alerte permanente, quel que soit
--     l'état réel des abonnements.
--   - Le check 6 (REVENUE_FIRST_INVOICE_TRUTH_DRIFT) compare deux ensembles
--     tous deux bloqués (analytics_events et invoices) : silencieux comme
--     les checks 1-4.
--
-- Fonctions SECURITY DEFINER étroites, strictement les mêmes requêtes que
-- l'original — jamais un accès arbitraire.

CREATE OR REPLACE FUNCTION reconcile_ledger_imbalance()
RETURNS TABLE(invoice_id INTEGER, organisation_id INTEGER, invoice_total NUMERIC, ledger_total NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH paid_ledger AS (
    SELECT
      pe.invoice_id,
      COALESCE(SUM(le.amount), 0) AS ledger_total
    FROM payment_events pe
    JOIN ledger_entries le
      ON le.reference_id = pe.stripe_event_id
     AND le.reference_type = 'stripe_webhook'
     AND le.type = 'payment_received'
    WHERE pe.type IN (
      'payment_intent.succeeded',
      'charge.succeeded',
      'invoice.payment_succeeded'
    )
    GROUP BY pe.invoice_id
  )
  SELECT
    i.id AS invoice_id,
    i.organisation_id,
    i.total AS invoice_total,
    pl.ledger_total
  FROM invoices i
  JOIN paid_ledger pl ON pl.invoice_id = i.id
  WHERE i.status = 'paid'
    AND ROUND(i.total::numeric, 2) != ROUND(pl.ledger_total::numeric, 2);
$$;

GRANT EXECUTE ON FUNCTION reconcile_ledger_imbalance() TO PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_webhook_mismatch()
RETURNS TABLE(invoice_id INTEGER, stripe_event_id VARCHAR, organisation_id INTEGER, stripe_total NUMERIC, ledger_total NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pe.invoice_id,
    pe.stripe_event_id,
    i.organisation_id,
    CASE
      WHEN pe.type = 'invoice.payment_succeeded'
        THEN (pe.payload->'data'->'object'->>'amount_paid')::numeric / 100
      ELSE (pe.payload->'data'->'object'->>'amount')::numeric / 100
    END AS stripe_total,
    SUM(le.amount) AS ledger_total
  FROM payment_events pe
  JOIN invoices i ON i.id = pe.invoice_id
  JOIN ledger_entries le
    ON le.reference_id = pe.stripe_event_id
   AND le.reference_type = 'stripe_webhook'
   AND le.type = 'payment_received'
  WHERE pe.type IN (
    'payment_intent.succeeded',
    'charge.succeeded',
    'invoice.payment_succeeded'
  )
  GROUP BY pe.invoice_id, pe.stripe_event_id, i.organisation_id, pe.type, pe.payload
  HAVING ROUND((CASE
    WHEN pe.type = 'invoice.payment_succeeded'
      THEN (pe.payload->'data'->'object'->>'amount_paid')::numeric / 100
    ELSE (pe.payload->'data'->'object'->>'amount')::numeric / 100
  END), 2) != ROUND(SUM(le.amount)::numeric, 2);
$$;

GRANT EXECUTE ON FUNCTION reconcile_webhook_mismatch() TO PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_data_drift()
RETURNS TABLE(invoice_id INTEGER, organisation_id INTEGER, status VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id AS invoice_id, i.organisation_id, i.status
  FROM invoices i
  WHERE i.status = 'paid'
    AND NOT EXISTS (
      SELECT 1
      FROM payment_events pe
      JOIN ledger_entries le
        ON le.reference_id = pe.stripe_event_id
       AND le.reference_type = 'stripe_webhook'
       AND le.type = 'payment_received'
      WHERE pe.invoice_id = i.id
        AND pe.type IN (
          'payment_intent.succeeded',
          'charge.succeeded',
          'invoice.payment_succeeded'
        )
    );
$$;

GRANT EXECUTE ON FUNCTION reconcile_data_drift() TO PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_payment_state_drift()
RETURNS TABLE(invoice_id INTEGER, organisation_id INTEGER, status VARCHAR, stripe_event_id VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT
    i.id AS invoice_id,
    i.organisation_id,
    i.status,
    pe.stripe_event_id
  FROM invoices i
  JOIN payment_events pe ON pe.invoice_id = i.id
  JOIN ledger_entries le
    ON le.reference_id = pe.stripe_event_id
   AND le.reference_type = 'stripe_webhook'
   AND le.type = 'payment_received'
  WHERE i.status != 'paid'
    AND pe.type IN (
      'payment_intent.succeeded',
      'charge.succeeded',
      'invoice.payment_succeeded'
    );
$$;

GRANT EXECUTE ON FUNCTION reconcile_payment_state_drift() TO PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_subscription_truth()
RETURNS TABLE(analytics_count BIGINT, db_count BIGINT, analytics_without_db BIGINT, db_without_analytics BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH analytics_subs AS (
    SELECT DISTINCT organisation_id
    FROM analytics_events
    WHERE event_name = 'subscription_active'
      AND created_at >= NOW() - INTERVAL '90 days'
  ),
  db_pro AS (
    SELECT id FROM organisations
    WHERE plan_type = 'pro' OR subscription_status = 'active'
  )
  SELECT
    (SELECT COUNT(*) FROM analytics_subs) AS analytics_count,
    (SELECT COUNT(*) FROM db_pro) AS db_count,
    (SELECT COUNT(*) FROM analytics_subs a
      LEFT JOIN db_pro d ON a.organisation_id = d.id
      WHERE d.id IS NULL) AS analytics_without_db,
    (SELECT COUNT(*) FROM db_pro d
      LEFT JOIN analytics_subs a ON d.id = a.organisation_id
      WHERE a.organisation_id IS NULL) AS db_without_analytics;
$$;

GRANT EXECUTE ON FUNCTION reconcile_subscription_truth() TO PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_first_invoice_truth()
RETURNS TABLE(analytics_count BIGINT, db_count BIGINT, analytics_without_db BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH analytics_first AS (
    SELECT DISTINCT organisation_id
    FROM analytics_events
    WHERE event_name = 'first_invoice_created'
      AND created_at >= NOW() - INTERVAL '90 days'
  ),
  actual_invoices AS (
    SELECT DISTINCT organisation_id FROM invoices
  )
  SELECT
    (SELECT COUNT(*) FROM analytics_first) AS analytics_count,
    (SELECT COUNT(*) FROM actual_invoices) AS db_count,
    (SELECT COUNT(*) FROM analytics_first a
      LEFT JOIN actual_invoices d ON a.organisation_id = d.organisation_id
      WHERE d.organisation_id IS NULL) AS analytics_without_db;
$$;

GRANT EXECUTE ON FUNCTION reconcile_first_invoice_truth() TO PUBLIC;
