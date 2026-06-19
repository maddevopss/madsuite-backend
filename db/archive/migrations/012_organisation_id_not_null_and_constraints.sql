-- Migration 012: verrouillage organisation_id obligatoire (SaaS)
-- Objectif:
--   - Empêcher l'écriture de lignes métier orphelines (organisation_id = NULL)
--   - Valider les données existantes après le backfill de 011
--
-- IMPORTANT:
--   - Le runner exécute un preflight avant cette migration.
--   - Cette migration est idempotente en dev/E2E: elle supprime les contraintes
--     strictes si elles existent déjà, puis les recrée et les valide.

ALTER TABLE utilisateurs
  DROP CONSTRAINT IF EXISTS chk_utilisateurs_organisation_id_not_null;

ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS chk_clients_organisation_id_not_null;

ALTER TABLE projets
  DROP CONSTRAINT IF EXISTS chk_projets_organisation_id_not_null;

ALTER TABLE time_entries
  DROP CONSTRAINT IF EXISTS chk_time_entries_organisation_id_not_null;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoices_organisation_id_not_null;

ALTER TABLE activity_logs
  DROP CONSTRAINT IF EXISTS chk_activity_logs_organisation_id_not_null;

ALTER TABLE activity_daily_summary
  DROP CONSTRAINT IF EXISTS chk_activity_daily_summary_organisation_id_not_null;


ALTER TABLE utilisateurs
  ADD CONSTRAINT chk_utilisateurs_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE clients
  ADD CONSTRAINT chk_clients_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE projets
  ADD CONSTRAINT chk_projets_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE time_entries
  ADD CONSTRAINT chk_time_entries_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE invoices
  ADD CONSTRAINT chk_invoices_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE activity_logs
  ADD CONSTRAINT chk_activity_logs_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE activity_daily_summary
  ADD CONSTRAINT chk_activity_daily_summary_organisation_id_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;


ALTER TABLE utilisateurs
  VALIDATE CONSTRAINT chk_utilisateurs_organisation_id_not_null;

ALTER TABLE clients
  VALIDATE CONSTRAINT chk_clients_organisation_id_not_null;

ALTER TABLE projets
  VALIDATE CONSTRAINT chk_projets_organisation_id_not_null;

ALTER TABLE time_entries
  VALIDATE CONSTRAINT chk_time_entries_organisation_id_not_null;

ALTER TABLE invoices
  VALIDATE CONSTRAINT chk_invoices_organisation_id_not_null;

ALTER TABLE activity_logs
  VALIDATE CONSTRAINT chk_activity_logs_organisation_id_not_null;

ALTER TABLE activity_daily_summary
  VALIDATE CONSTRAINT chk_activity_daily_summary_organisation_id_not_null;
