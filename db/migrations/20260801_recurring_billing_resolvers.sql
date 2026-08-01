-- 20260801_recurring_billing_resolvers.sql
-- recurringInvoiceJob.js et billingAssistantJob.js scannent en lot les
-- récurrences/soumissions dues sur TOUTES les organisations, avant même de
-- savoir dans quelle organisation traiter chaque ligne. Leurs requêtes
-- initiales joignent invoices/clients/estimates (RLS FORCE) sur une
-- connexion non scopée : toujours 0 ligne, donc les factures récurrentes
-- automatiques et les relances de soumissions n'ont jamais été émises.
--
-- Fonctions SECURITY DEFINER étroites, mêmes requêtes + verrouillage
-- (FOR UPDATE SKIP LOCKED) que l'original — le verrou est tenu par la
-- transaction appelante puisque ces fonctions n'ouvrent pas de nouvelle
-- transaction.

CREATE OR REPLACE FUNCTION list_due_recurring_invoices()
RETURNS TABLE(
  id INTEGER,
  organisation_id INTEGER,
  client_id INTEGER,
  template_invoice_id INTEGER,
  frequency VARCHAR,
  next_issue_date DATE,
  status VARCHAR,
  notes TEXT,
  subtotal NUMERIC,
  tax_total NUMERIC,
  total NUMERIC,
  client_email VARCHAR
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.organisation_id, r.client_id, r.template_invoice_id, r.frequency,
         r.next_issue_date, r.status, i.notes, i.subtotal, i.tax_total, i.total, c.email
  FROM recurring_invoices r
  JOIN invoices i ON r.template_invoice_id = i.id
    AND r.organisation_id = i.organisation_id
  JOIN clients c ON r.client_id = c.id
    AND r.organisation_id = c.organisation_id
  WHERE r.status = 'active'
    AND r.next_issue_date <= CURRENT_DATE
    AND r.organisation_id IS NOT NULL
  FOR UPDATE OF r SKIP LOCKED;
$$;

GRANT EXECUTE ON FUNCTION list_due_recurring_invoices() TO PUBLIC;

-- Reprend l'intégralité des colonnes d'estimates (comme l'original SELECT e.*),
-- pour ne rien retirer silencieusement de la charge utile transmise à l'outbox
-- (email de relance), qui peut référencer n'importe quel champ de l'estimation.
CREATE OR REPLACE FUNCTION list_due_estimate_reminders()
RETURNS TABLE(
  id INTEGER,
  organisation_id INTEGER,
  client_id INTEGER,
  estimate_number VARCHAR,
  status VARCHAR,
  issue_date DATE,
  valid_until DATE,
  subtotal NUMERIC,
  tax_total NUMERIC,
  total NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  reminders_sent INTEGER,
  last_reminder_at TIMESTAMPTZ,
  public_token UUID,
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  signed_ip VARCHAR,
  client_email VARCHAR
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.organisation_id, e.client_id, e.estimate_number, e.status,
         e.issue_date, e.valid_until, e.subtotal, e.tax_total, e.total, e.notes,
         e.created_at, e.updated_at, e.deleted_at, e.reminders_sent, e.last_reminder_at,
         e.public_token, e.signature_data, e.signed_at, e.signed_ip, c.email
  FROM estimates e
  JOIN clients c ON e.client_id = c.id AND c.organisation_id = e.organisation_id
  WHERE e.status = 'sent'
    AND e.valid_until < CURRENT_DATE
    AND e.reminders_sent < 3
    AND (e.last_reminder_at IS NULL OR e.last_reminder_at < NOW() - INTERVAL '3 days')
    AND e.deleted_at IS NULL
  FOR UPDATE OF e SKIP LOCKED;
$$;

GRANT EXECUTE ON FUNCTION list_due_estimate_reminders() TO PUBLIC;
