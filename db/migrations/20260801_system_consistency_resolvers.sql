-- 20260801_system_consistency_resolvers.sql
-- systemConsistencyJob.js et systemHealth.service.js exécutent des vérifications
-- d'invariants intentionnellement cross-tenant (détection d'anomalies à l'échelle
-- de la plateforme), via des connexions non scopées (pool.query direct). Mais
-- time_entries/expenses/invoices sont sous RLS FORCE : sans contexte d'organisation,
-- ces requêtes retournaient silencieusement 0 ligne — chaque invariant rapportait
-- PASS à tort, y compris stripe_payment_propagation (dérive de paiement Stripe),
-- seul déclencheur du statut UNHEALTHY dans systemHealth.service.js. Le moniteur
-- de santé système ne pouvait donc jamais détecter une vraie dérive financière.
--
-- Fonctions SECURITY DEFINER étroites, strictement équivalentes aux requêtes
-- qu'elles remplacent — jamais un accès arbitraire.

CREATE OR REPLACE FUNCTION check_invoice_immutability_violations()
RETURNS TABLE(id INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id FROM time_entries t
  WHERE t.invoice_id IS NOT NULL AND t.is_billed = false
  UNION
  SELECT e.id FROM expenses e
  WHERE e.invoice_id IS NOT NULL AND e.is_billed = false
$$;

GRANT EXECUTE ON FUNCTION check_invoice_immutability_violations() TO PUBLIC;

CREATE OR REPLACE FUNCTION check_invoice_idempotency_violations()
RETURNS TABLE(idempotency_key VARCHAR, count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT idempotency_key, count(*) as count
  FROM invoices
  WHERE idempotency_key IS NOT NULL
  GROUP BY idempotency_key
  HAVING count(*) > 1
$$;

GRANT EXECUTE ON FUNCTION check_invoice_idempotency_violations() TO PUBLIC;

CREATE OR REPLACE FUNCTION check_invoice_ledger_violations()
RETURNS TABLE(id INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id
  FROM invoices i
  LEFT JOIN ledger_entries le ON le.reference_id = i.id::text AND le.reference_type = 'invoice'
  WHERE i.status = 'paid' AND le.id IS NULL
$$;

GRANT EXECUTE ON FUNCTION check_invoice_ledger_violations() TO PUBLIC;

-- Remplace la vérification stripe_payment_propagation historique, qui référençait
-- des colonnes inexistantes sur payment_events (reference_id/reference_type/status
-- au lieu de invoice_id/type) et échouait donc systématiquement en erreur — jamais
-- silencieusement, mais jamais fonctionnelle non plus.
CREATE OR REPLACE FUNCTION check_stripe_payment_status_drift()
RETURNS TABLE(id INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pe.id
  FROM payment_events pe
  JOIN invoices i ON i.id = pe.invoice_id
  WHERE pe.type IN ('payment_intent.succeeded', 'charge.succeeded', 'invoice.payment_succeeded')
    AND i.status != 'paid'
$$;

GRANT EXECUTE ON FUNCTION check_stripe_payment_status_drift() TO PUBLIC;
