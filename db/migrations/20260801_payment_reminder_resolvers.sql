-- 20260801_payment_reminder_resolvers.sql
-- Découvert en finalisant l'audit des jobs cron (#672-#676) : outboxWorker.js
-- traite les événements de relance ("dunning_reminder") issus de
-- billingAssistantJob.js hors de tout contexte requête. payment-reminder-
-- delivery.service.js listait les organisations avec relances automatiques
-- activées via une lecture directe sur payment_reminder_settings (RLS
-- FORCE) sans contexte d'organisation : toujours 0 ligne — les relances
-- automatiques de factures en retard n'ont jamais été mises en file, quel
-- que soit le paramétrage des organisations.

CREATE OR REPLACE FUNCTION list_orgs_with_automatic_reminders()
RETURNS TABLE(organisation_id INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organisation_id
  FROM payment_reminder_settings
  WHERE automatic_enabled = TRUE;
$$;

GRANT EXECUTE ON FUNCTION list_orgs_with_automatic_reminders() TO PUBLIC;
