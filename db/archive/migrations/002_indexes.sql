-- ============================================================
-- MADSuite / TimeMonitoring
-- 002_indexes.sql
-- Index seulement
-- ============================================================

-- Utilisateurs
CREATE INDEX IF NOT EXISTS idx_utilisateurs_email
ON utilisateurs(email);

CREATE INDEX IF NOT EXISTS idx_utilisateurs_deleted_at
ON utilisateurs(deleted_at);

-- Clients
CREATE INDEX IF NOT EXISTS idx_clients_email
ON clients(email);

-- Projets
CREATE INDEX IF NOT EXISTS idx_projets_client_id
ON projets(client_id);

-- Entrées de temps
CREATE INDEX IF NOT EXISTS idx_time_entries_projet_id
ON time_entries(projet_id);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_id
ON time_entries(utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_time_entries_start_time
ON time_entries(start_time);

CREATE INDEX IF NOT EXISTS idx_time_entries_start_user
ON time_entries(start_time, utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_time_entries_project_start
ON time_entries(projet_id, start_time);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_start
ON time_entries(utilisateur_id, start_time);

CREATE INDEX IF NOT EXISTS idx_time_entries_invoice_id
ON time_entries(invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_user
ON time_entries(utilisateur_id)
WHERE end_time IS NULL AND deleted_at IS NULL;

-- Factures
CREATE INDEX IF NOT EXISTS idx_invoices_org_status
ON invoices(organisation_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client_id
ON invoices(client_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id
ON invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_time_entry_id
ON invoice_items(time_entry_id);

-- Activity logs / tracking
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id
ON activity_logs(utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_type
ON activity_logs(type);

CREATE INDEX IF NOT EXISTS idx_activity_logs_signature
ON activity_logs(utilisateur_id, activity_signature)
WHERE activity_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_time
ON activity_logs(utilisateur_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_activity_logs_category
ON activity_logs(activity_category);

CREATE INDEX IF NOT EXISTS idx_activity_daily_summary_user_date
ON activity_daily_summary(utilisateur_id, activity_date);

-- Intelligence / patterns
CREATE INDEX IF NOT EXISTS idx_activity_patterns_projet_id
ON activity_patterns(projet_id);

CREATE INDEX IF NOT EXISTS idx_activity_app_rules_org_active
ON activity_app_rules(organisation_id, active);

CREATE INDEX IF NOT EXISTS idx_activity_feedback_user_date
ON activity_feedback(utilisateur_id, created_at);

CREATE INDEX IF NOT EXISTS idx_activity_context_rules_org_active
ON activity_context_rules(organisation_id, active);

-- Sessions / summaries
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
ON user_sessions(utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date
ON daily_summaries(utilisateur_id, summary_date);
