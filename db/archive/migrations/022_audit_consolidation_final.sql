-- Migration 022: Consolidation Sécurité et Performance (Post-Audit)
-- 1. CRITICAL: Isolation Activity Rules
-- On drop avant d'ajouter pour rendre la migration rejouable en environnement de test

ALTER TABLE activity_patterns
  DROP CONSTRAINT IF EXISTS chk_activity_patterns_org_not_null;

ALTER TABLE activity_patterns
  ADD CONSTRAINT chk_activity_patterns_org_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE activity_app_rules
  DROP CONSTRAINT IF EXISTS chk_activity_app_rules_org_not_null;

ALTER TABLE activity_app_rules 
  ADD CONSTRAINT chk_activity_app_rules_org_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE activity_context_rules
  DROP CONSTRAINT IF EXISTS chk_activity_context_rules_org_not_null;

ALTER TABLE activity_context_rules 
  ADD CONSTRAINT chk_activity_context_rules_org_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

-- Validation des contraintes
ALTER TABLE activity_patterns VALIDATE CONSTRAINT chk_activity_patterns_org_not_null;
ALTER TABLE activity_app_rules VALIDATE CONSTRAINT chk_activity_app_rules_org_not_null;
ALTER TABLE activity_context_rules VALIDATE CONSTRAINT chk_activity_context_rules_org_not_null;

-- 2. IMPORTANT: User Sessions Isolation
ALTER TABLE user_sessions 
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE;

ALTER TABLE user_sessions
  DROP CONSTRAINT IF EXISTS chk_user_sessions_org_not_null;

ALTER TABLE user_sessions 
  ADD CONSTRAINT chk_user_sessions_org_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE user_sessions VALIDATE CONSTRAINT chk_user_sessions_org_not_null;

CREATE INDEX IF NOT EXISTS idx_user_sessions_org_user 
  ON user_sessions(organisation_id, utilisateur_id);

-- 3. IMPORTANT: Correction FK Utilisateurs
ALTER TABLE utilisateurs
  DROP CONSTRAINT IF EXISTS fk_utilisateurs_organisation;

ALTER TABLE utilisateurs 
  ADD CONSTRAINT fk_utilisateurs_organisation 
  FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;

-- 4. PERFORMANCE: Indexes manquants

CREATE INDEX IF NOT EXISTS idx_utilisateurs_org_created 
  ON utilisateurs(organisation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_org_created 
  ON clients(organisation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projets_org_created 
  ON projets(organisation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projets_client_org_perf
  ON projets(client_id, organisation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_items_org_composite
  ON invoice_items(invoice_id, organisation_id);

CREATE INDEX IF NOT EXISTS idx_invoices_org_perf
  ON invoices(organisation_id, created_at DESC) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_org_unbilled
  ON time_entries(organisation_id, is_billed, created_at)
  WHERE invoice_id IS NULL AND deleted_at IS NULL;

-- 4.1 Indexes pour le job de cleanup global

CREATE INDEX IF NOT EXISTS idx_time_entries_deleted_cleanup 
  ON time_entries(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_utilisateurs_deleted_cleanup
  ON utilisateurs(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_deleted_cleanup
  ON clients(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projets_deleted_cleanup
  ON projets(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_deleted_cleanup
  ON invoices(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 5. INTEGRITY: Sécurisation finale des Invoice Items

ALTER TABLE invoice_items
  DROP CONSTRAINT IF EXISTS chk_invoice_items_org_not_null;

ALTER TABLE invoice_items 
  ADD CONSTRAINT chk_invoice_items_org_not_null
  CHECK (organisation_id IS NOT NULL) NOT VALID;

ALTER TABLE invoice_items VALIDATE CONSTRAINT chk_invoice_items_org_not_null;

