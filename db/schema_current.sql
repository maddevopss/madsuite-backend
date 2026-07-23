-- MADSuite / TimeMonitoring
-- schema_current.sql
-- Snapshot complet de la base courante.
-- Generé automatiquement à partir des migrations actives.

-- ============================================================
-- Migration source: 001_schema.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 001_schema.sql
-- Tables seulement
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Organisations
-- ============================================================

CREATE TABLE IF NOT EXISTS organisations (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. Utilisateurs
-- ============================================================

CREATE TABLE IF NOT EXISTS utilisateurs (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  mot_de_passe TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'employe',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  role_org VARCHAR(30) DEFAULT 'user',

   CONSTRAINT chk_role
     CHECK (role IN ('admin', 'manager', 'employe')),

  CONSTRAINT uq_utilisateurs_id_org
    UNIQUE (id, organisation_id)
);

-- ============================================================
-- 3. Clients
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  hourly_rate_defaut DECIMAL(10, 2) CHECK (hourly_rate_defaut >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,

  CONSTRAINT uq_clients_id_org
    UNIQUE (id, organisation_id)
);

-- ============================================================
-- 4. Projets
-- ============================================================

CREATE TABLE IF NOT EXISTS projets (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  nom VARCHAR(255) NOT NULL,
  description TEXT,
  date_fin DATE,
  budget DECIMAL(10, 2) CHECK (budget >= 0),
  estimated_hours DECIMAL(8, 2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  taux_horaire DECIMAL(10, 2) CHECK (taux_horaire >= 0),
  status VARCHAR(50) DEFAULT 'actif'
    CHECK (status IN ('actif', 'pause', 'termine', 'archive')),
  couleur VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,

  CONSTRAINT fk_client
    FOREIGN KEY (client_id)
    REFERENCES clients(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_projets_client_org
    FOREIGN KEY (client_id, organisation_id)
    REFERENCES clients(id, organisation_id)
    ON DELETE CASCADE,

  CONSTRAINT uq_projets_id_org
    UNIQUE (id, organisation_id)
);

-- ============================================================
-- 5. Entrées de temps
-- ============================================================

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER NOT NULL,
  utilisateur_id INTEGER NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  description TEXT,
  hourly_rate_used DECIMAL(10, 2) CHECK (hourly_rate_used >= 0),
  is_billed BOOLEAN DEFAULT FALSE,
  invoice_id INTEGER,
  distance_km DECIMAL(10, 2) DEFAULT 0 CHECK (distance_km >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,

  CONSTRAINT fk_projet
    FOREIGN KEY (projet_id)
    REFERENCES projets(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_time_entries_projet_org
    FOREIGN KEY (projet_id, organisation_id)
    REFERENCES projets(id, organisation_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_utilisateur
    FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateurs(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_time_entries_utilisateur_org
    FOREIGN KEY (utilisateur_id, organisation_id)
    REFERENCES utilisateurs(id, organisation_id)
    ON DELETE CASCADE,

  CONSTRAINT chk_time
    CHECK (end_time IS NULL OR end_time >= start_time)
);

-- ============================================================
-- 6. Sessions utilisateur
-- ============================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER REFERENCES utilisateurs(id),
  login_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  logout_time TIMESTAMPTZ,
  duration_seconds INTEGER,
  active BOOLEAN DEFAULT TRUE,
  ip_address VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. Logs d'activité desktop
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL,
  app_name VARCHAR(255),
  window_title TEXT,
  is_idle BOOLEAN DEFAULT FALSE,
  idle_seconds INTEGER DEFAULT 0 CHECK (idle_seconds >= 0),
  activity_signature TEXT,
  type VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (type IN ('active', 'background')),
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  captured_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  project_suggestion_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
  confidence_score INTEGER DEFAULT 0,
  activity_category VARCHAR(80),

  CONSTRAINT fk_user_log
    FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateurs(id)
    ON DELETE CASCADE
);

-- ============================================================
-- 8. Résumés quotidiens d'activité brute
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_daily_summary (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL,
  app_name VARCHAR(255),
  window_title TEXT,
  total_seconds INTEGER DEFAULT 0,
  activity_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_activity_summary_user
    FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateurs(id)
    ON DELETE CASCADE,

  CONSTRAINT unique_daily_activity
    UNIQUE (utilisateur_id, app_name, window_title, activity_date)
);

-- ============================================================
-- 9. Patterns de détection projet
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_patterns (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  projet_id INTEGER REFERENCES projets(id) ON DELETE CASCADE,
  keyword VARCHAR(255) NOT NULL,
  weight INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 10. Règles simples d'intelligence d'activité
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_app_rules (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  app_pattern VARCHAR(255) NOT NULL,
  title_pattern VARCHAR(500),
  category VARCHAR(80) NOT NULL,
  tag VARCHAR(80),
  confidence INTEGER DEFAULT 70 CHECK (confidence >= 0 AND confidence <= 100),
  is_productive BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 10,
  active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 11. Feedback utilisateur sur intelligence d'activité
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_feedback (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  activity_log_id INTEGER REFERENCES activity_logs(id) ON DELETE SET NULL,
  projet_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
  app_name VARCHAR(255),
  window_title TEXT,
  confirmed_category VARCHAR(80),
  confirmed_tag VARCHAR(80),
  feedback_type VARCHAR(30) NOT NULL DEFAULT 'confirmed'
    CHECK (feedback_type IN ('confirmed', 'rejected', 'corrected')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 12. Règles multi-contexte d'intelligence d'activité
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_context_rules (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  nom VARCHAR(150) NOT NULL,
  required_patterns TEXT[] NOT NULL DEFAULT '{}',
  category VARCHAR(80) NOT NULL,
  tag VARCHAR(80),
  confidence INTEGER DEFAULT 80 CHECK (confidence >= 0 AND confidence <= 100),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 13. Résumés intelligents quotidiens
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_summaries (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  total_seconds INTEGER DEFAULT 0,
  billable_seconds INTEGER DEFAULT 0,
  summary_text TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (organisation_id, utilisateur_id, summary_date)
);

-- ============================================================
-- 14. Factures
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  issue_date DATE,
  due_date DATE,
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_invoices_id_org
    UNIQUE (id, organisation_id),

  CONSTRAINT uq_invoices_number_org
    UNIQUE (organisation_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE SET NULL,
  description TEXT,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_rate DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_invoice_items_id_org
    UNIQUE (id, organisation_id)
);

-- ============================================================
-- 15. Suggestions IA pour facturation
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_ai_suggestions (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE CASCADE,
  original_description TEXT,
  suggested_description TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_invoice') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_invoice
      FOREIGN KEY (invoice_id, organisation_id)
      REFERENCES invoices(id, organisation_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_utilisateurs_updated_at ON utilisateurs;
CREATE TRIGGER trg_utilisateurs_updated_at
BEFORE UPDATE ON utilisateurs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_projets_updated_at ON projets;
CREATE TRIGGER trg_projets_updated_at
BEFORE UPDATE ON projets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries;
CREATE TRIGGER trg_time_entries_updated_at
BEFORE UPDATE ON time_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- ============================================================
-- Migration source: 002_indexes.sql
-- ============================================================
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

-- ============================================================
-- Migration source: 003_seed.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 003_seed.sql
-- ============================================================

-- Les utilisateurs ne sont plus seedes en SQL.
-- Utiliser backend/seed.js afin de generer de vrais hash bcrypt depuis les variables SEED_*.

-- ============================================================
-- Migration source: 004_refresh_tokens.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 004_refresh_tokens.sql
-- Refresh tokens persistés et rotation
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  ip_address VARCHAR(255),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
ON refresh_tokens(utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
ON refresh_tokens(session_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
ON refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
ON refresh_tokens(session_id, revoked_at, expires_at);

-- ============================================================
-- Migration source: 005_audit_columns_and_org_constraints.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 005_audit_columns_and_org_constraints.sql
-- Colonnes d'audit legeres et garde-fous multi-organisation
-- ============================================================

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

ALTER TABLE projets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS estimated_hours DECIMAL(8, 2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0);

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS invoice_id INTEGER;

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_utilisateurs_updated_at ON utilisateurs;
CREATE TRIGGER trg_utilisateurs_updated_at
BEFORE UPDATE ON utilisateurs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_projets_updated_at ON projets;
CREATE TRIGGER trg_projets_updated_at
BEFORE UPDATE ON projets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries;
CREATE TRIGGER trg_time_entries_updated_at
BEFORE UPDATE ON time_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_utilisateurs_id_org') THEN
    ALTER TABLE utilisateurs
      ADD CONSTRAINT uq_utilisateurs_id_org UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_clients_id_org') THEN
    ALTER TABLE clients
      ADD CONSTRAINT uq_clients_id_org UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_projets_id_org') THEN
    ALTER TABLE projets
      ADD CONSTRAINT uq_projets_id_org UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projets_client_org') THEN
    ALTER TABLE projets
      ADD CONSTRAINT fk_projets_client_org
      FOREIGN KEY (client_id, organisation_id)
      REFERENCES clients(id, organisation_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_projet_org') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_projet_org
      FOREIGN KEY (projet_id, organisation_id)
      REFERENCES projets(id, organisation_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_utilisateur_org') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_utilisateur_org
      FOREIGN KEY (utilisateur_id, organisation_id)
      REFERENCES utilisateurs(id, organisation_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_clients_email
ON clients(email);

CREATE INDEX IF NOT EXISTS idx_time_entries_invoice_id
ON time_entries(invoice_id);

-- ============================================================
-- Migration source: 006_billing_and_timestamptz.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 006_billing_and_timestamptz.sql
-- Base facturation + timestamps timezone-aware
-- ============================================================

DO $$
DECLARE
  table_column RECORD;
BEGIN
  FOR table_column IN
    SELECT *
    FROM (VALUES
      ('organisations', 'created_at'),
      ('utilisateurs', 'created_at'),
      ('utilisateurs', 'updated_at'),
      ('utilisateurs', 'last_login_at'),
      ('utilisateurs', 'deleted_at'),
      ('clients', 'created_at'),
      ('clients', 'updated_at'),
      ('clients', 'deleted_at'),
      ('projets', 'created_at'),
      ('projets', 'updated_at'),
      ('projets', 'deleted_at'),
      ('time_entries', 'start_time'),
      ('time_entries', 'end_time'),
      ('time_entries', 'created_at'),
      ('time_entries', 'updated_at'),
      ('time_entries', 'deleted_at'),
      ('user_sessions', 'login_time'),
      ('user_sessions', 'logout_time'),
      ('user_sessions', 'created_at'),
      ('activity_logs', 'captured_at'),
      ('activity_daily_summary', 'created_at'),
      ('activity_patterns', 'created_at'),
      ('activity_app_rules', 'created_at'),
      ('activity_app_rules', 'updated_at'),
      ('activity_feedback', 'created_at'),
      ('activity_context_rules', 'created_at'),
      ('activity_context_rules', 'updated_at'),
      ('daily_summaries', 'created_at'),
      ('billing_ai_suggestions', 'created_at'),
      ('refresh_tokens', 'expires_at'),
      ('refresh_tokens', 'revoked_at'),
      ('refresh_tokens', 'created_at')
    ) AS columns(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = table_column.table_name
        AND column_name = table_column.column_name
        AND data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE current_setting(''TIMEZONE'')',
        table_column.table_name,
        table_column.column_name,
        table_column.column_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  issue_date DATE,
  due_date DATE,
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_invoices_id_org
    UNIQUE (id, organisation_id),

  CONSTRAINT uq_invoices_number_org
    UNIQUE (organisation_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE SET NULL,
  description TEXT,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_rate DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_invoice_items_id_org
    UNIQUE (id, organisation_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_invoice') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_invoice
      FOREIGN KEY (invoice_id, organisation_id)
      REFERENCES invoices(id, organisation_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_invoices_org_status
ON invoices(organisation_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client_id
ON invoices(client_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id
ON invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_time_entry_id
ON invoice_items(time_entry_id);

DROP INDEX IF EXISTS idx_one_active_timer_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_user
ON time_entries(utilisateur_id)
WHERE end_time IS NULL AND deleted_at IS NULL;

-- ============================================================
-- Migration source: 007_timer_quick_note.sql
-- ============================================================
-- Phase 4: Timer intelligent
-- 1. Ajout colonne 'note' pour note rapide sur timer actif
-- 2. Index pour requetes avec fuseau horaire

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS note TEXT;

-- Index composite pour requetes timesheet avec timezone
CREATE INDEX IF NOT EXISTS idx_time_entries_user_start_tz
  ON time_entries (utilisateur_id, (start_time AT TIME ZONE 'America/Montreal'));

-- ============================================================
-- Migration source: 008_timezone_per_organisation.sql
-- ============================================================
-- Migration 008: Ajouter colonne timezone par organisation
-- Permet de stocker le fuseau horaire de chaque organisation
-- au lieu de hardcoder 'America/Montreal' dans les requetes SQL

ALTER TABLE organisations
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/Montreal';

-- Met a jour la valeur par defaut pour les organisations existantes
UPDATE organisations SET timezone = 'America/Montreal' WHERE timezone IS NULL;

ALTER TABLE organisations
ALTER COLUMN timezone SET NOT NULL;

-- ============================================================
-- Migration source: 009_invoices_billing_metadata.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 009_invoices_billing_metadata.sql
-- Facturation: ajouter billed_at / billed_by sur invoices
-- ============================================================

DO $$
BEGIN
  -- billed_at
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'invoices'
      AND column_name = 'billed_at'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN billed_at TIMESTAMPTZ;
  END IF;

  -- billed_by
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'invoices'
      AND column_name = 'billed_by'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN billed_by INTEGER;
  END IF;

  -- FK billed_by -> utilisateurs(id)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_invoices_billed_by'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_billed_by
      FOREIGN KEY (billed_by)
      REFERENCES utilisateurs(id)
      ON DELETE SET NULL;
  END IF;

  -- Index pour filtrage
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'idx_invoices_org_billed_at'
  ) THEN
    CREATE INDEX idx_invoices_org_billed_at
      ON invoices(organisation_id, billed_at)
      WHERE deleted_at IS NULL;
  END IF;
END;
$$;

-- ============================================================
-- Migration source: 010_security_indexes_and_org_guards.sql
-- ============================================================
-- Migration 010: indexes de securite/performance et garde-fous organisation.

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_user_time
ON activity_logs(organisation_id, utilisateur_id, captured_at);

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_user_time_active
ON activity_logs(organisation_id, utilisateur_id, captured_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
ON user_sessions(active)
WHERE active = true;

-- NOTE:
-- La contrainte organisation_id obligatoire de time_entries est geree dans
-- 012_organisation_id_not_null_and_constraints.sql.
-- Ne pas l'ajouter ici, sinon les migrations dev/E2E rejouees peuvent planter
-- avec duplicate_object / MergeWithExistingConstraint.

-- ============================================================
-- Migration source: 011_backfill_activity_and_org_scope.sql
-- ============================================================
-- Migration 011: backfill du scope organisation et resume activite.

ALTER TABLE activity_daily_summary
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);

UPDATE activity_daily_summary ads
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE ads.utilisateur_id = u.id
  AND ads.organisation_id IS NULL;

UPDATE activity_logs al
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE al.utilisateur_id = u.id
  AND al.organisation_id IS NULL;

UPDATE time_entries te
SET organisation_id = COALESCE(
  (SELECT u.organisation_id FROM utilisateurs u WHERE u.id = te.utilisateur_id),
  (SELECT p.organisation_id FROM projets p WHERE p.id = te.projet_id)
)
WHERE te.organisation_id IS NULL;

UPDATE activity_app_rules
SET organisation_id = (SELECT id FROM organisations ORDER BY id LIMIT 1)
WHERE organisation_id IS NULL
  AND (SELECT COUNT(*) FROM organisations) = 1;

CREATE INDEX IF NOT EXISTS idx_activity_daily_summary_org_user_date
ON activity_daily_summary(organisation_id, utilisateur_id, activity_date);

-- La validation stricte de chk_time_entries_organisation_id_not_null
-- est faite dans 012_organisation_id_not_null_and_constraints.sql.

-- ============================================================
-- Migration source: 012_organisation_id_not_null_and_constraints.sql
-- ============================================================
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

-- ============================================================
-- Migration source: 013_business_audit_logs.sql
-- ============================================================
-- Migration 013: audit log metier pour actions sensibles

CREATE TABLE IF NOT EXISTS business_audit_logs (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_audit_logs_org_created
ON business_audit_logs(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_audit_logs_entity
ON business_audit_logs(entity_type, entity_id);

-- ============================================================
-- Migration source: 014_active_timer_per_organisation.sql
-- ============================================================
-- Un seul timer actif par utilisateur et par organisation.
-- organisation_id rend explicite la portée SaaS de cette règle métier.

DROP INDEX IF EXISTS idx_one_active_timer_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_user_org
ON time_entries(organisation_id, utilisateur_id)
WHERE end_time IS NULL AND deleted_at IS NULL;

-- ============================================================
-- Migration source: 015_organisation_retention_policies.sql
-- ============================================================
-- Migration 015: Délais de rétention configurables par organisation

ALTER TABLE organisations
ADD COLUMN IF NOT EXISTS retention_activity_logs_days INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS retention_summary_days INTEGER DEFAULT 90,
ADD COLUMN IF NOT EXISTS retention_audit_logs_days INTEGER DEFAULT 365;

-- ============================================================
-- Migration source: 016_index_audit_logs.sql
-- ============================================================


-- ============================================================
-- Migration source: 016_performance_and_audit_indexes_merged.sql
-- ============================================================
-- Migration 016: Fusion Performance & Audit Indexes
-- 1. Nettoyage de l'ancien index d'audit (si existant)
DROP INDEX IF EXISTS idx_audit_logs_org_created;

-- 2. Indexation optimisée pour les logs d'audit métier
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_created 
ON business_audit_logs(organisation_id, action, created_at DESC);

-- 3. Indexes pour accélérer le job de rétention (dataRetention.js)
-- Accélère le DELETE sur activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_retention_lookup 
ON activity_logs (organisation_id, captured_at)
WHERE deleted_at IS NULL;

-- Accélère le DELETE sur activity_daily_summary
CREATE INDEX IF NOT EXISTS idx_activity_summary_retention_lookup 
ON activity_daily_summary (organisation_id, activity_date);

-- Accélère le DELETE sur business_audit_logs
CREATE INDEX IF NOT EXISTS idx_business_audit_logs_retention_lookup 
ON business_audit_logs (organisation_id, created_at);

-- ============================================================
-- Migration source: 016_performance_indexes_retention.sql
-- ============================================================


-- ============================================================
-- Migration source: 017_partial_indexes_cleanup.sql
-- ============================================================
-- Migration 017 : Index partiel pour le nettoyage des données soft-deleted

-- Cet index ne pèsera presque rien car il n'inclut que les lignes où deleted_at est présent.
-- Idéal pour accélérer : DELETE FROM activity_logs WHERE deleted_at IS NOT NULL AND ...
CREATE INDEX IF NOT EXISTS idx_activity_logs_deleted_cleanup
ON activity_logs (organisation_id, deleted_at)
WHERE deleted_at IS NOT NULL;

-- Application du même principe pour les entrées de temps
CREATE INDEX IF NOT EXISTS idx_time_entries_deleted_cleanup
ON time_entries (organisation_id, deleted_at)
WHERE deleted_at IS NOT NULL;

-- ============================================================
-- Migration source: 018_add_is_aggregated_to_activity_logs.sql
-- ============================================================
-- Migration 018 : Ajout du flag d'agrégation pour optimiser la purge

ALTER TABLE activity_logs 
ADD COLUMN IF NOT EXISTS is_aggregated BOOLEAN DEFAULT FALSE;

-- Index partiel pour accélérer la purge des données déjà agrégées
CREATE INDEX IF NOT EXISTS idx_activity_logs_purge_ready
ON activity_logs (organisation_id, captured_at)
WHERE is_aggregated = TRUE;

COMMENT ON COLUMN activity_logs.is_aggregated IS 'Indique si le log a été inclus dans le résumé quotidien (activity_daily_summary)';

-- ============================================================
-- Migration source: 019_activity_rules_org_not_null.sql
-- ============================================================


-- ============================================================
-- Migration source: 019_enable_rls.sql
-- ============================================================


-- ============================================================
-- Migration source: 019a_activity_rules_org_not_null.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 019a_activity_rules_org_not_null.sql
-- Sécurité Multi-Tenant: activity_* tables doivent avoir
-- organisation_id NOT NULL pour empêcher les fuites cross-org
-- ============================================================

-- Preflight: backfill NULL org_id avant d'ajouter NOT NULL
-- On rattache aux projets via laFK projet_id -> client -> org

-- activity_patterns: backfill via projet_id -> client -> organisation
UPDATE activity_patterns ap
SET organisation_id = p.organisation_id
FROM projets p
WHERE ap.projet_id = p.id
  AND ap.organisation_id IS NULL;

-- activity_app_rules: backfill via created_by -> utilisateur -> organisation
UPDATE activity_app_rules aar
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE aar.created_by = u.id
  AND aar.organisation_id IS NULL;

-- activity_context_rules: pas de FK directe, on ne peut pasbacker --
-- ces enregistrements doivent être supprimés ou assignés manuellement
-- (ticket à traiter avant migration si des NULL existent)

-- application des contraintes NOT NULL + CHECK

ALTER TABLE activity_patterns
  ALTER COLUMN organisation_id SET NOT NULL;

-- ALTER TABLE activity_patterns
--   ADD CONSTRAINT chk_activity_patterns_org_not_null
--   CHECK (organisation_id IS NOT NULL);

ALTER TABLE activity_app_rules
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE activity_app_rules
  ADD CONSTRAINT chk_activity_app_rules_org_not_null
  CHECK (organisation_id IS NOT NULL);

ALTER TABLE activity_context_rules
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE activity_context_rules
  ADD CONSTRAINT chk_activity_context_rules_org_not_null
  CHECK (organisation_id IS NOT NULL);

-- ============================================================
-- Migration source: 019b_enable_rls.sql
-- ============================================================
-- Activation du RLS pour les tables critiques
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY organisation_isolation_policy ON activity_logs
    USING (organisation_id = current_setting('app.current_organisation_id')::integer);
-- Cette politique force PostgreSQL à filtrer les données, même si le développeur oublie le WHERE.

-- ============================================================
-- Migration source: 020_user_sessions_org_not_null.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 020_user_sessions_org_not_null.sql
-- Sécurité Multi-Tenant: user_sessions doit avoir
-- organisation_id NOT NULL pour isoler les sessions par org
-- ============================================================

-- Ajout colonne + FK vers organisations
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE;

-- Backfill via utilisateur_id -> utilisateurs.organisation_id
UPDATE user_sessions us
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE us.utilisateur_id = u.id
  AND us.organisation_id IS NULL;

-- Contraintes NOT NULL + CHECK
ALTER TABLE user_sessions
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE user_sessions
  ADD CONSTRAINT chk_user_sessions_org_not_null
  CHECK (organisation_id IS NOT NULL);

-- ============================================================
-- Migration source: 021_performance_org_listings_indexes.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 021_performance_org_listings_indexes.sql
-- Performance: indexes pour listings par organisation
-- (5 indexes pour requêtes Multi-Tenant)
-- ============================================================

-- Utilisateurs: listing actif par org
CREATE INDEX IF NOT EXISTS idx_utilisateurs_org_deleted
ON utilisateurs(organisation_id, deleted_at)
WHERE deleted_at IS NULL;

-- Clients: listing actif par org
CREATE INDEX IF NOT EXISTS idx_clients_org_deleted
ON clients(organisation_id, deleted_at)
WHERE deleted_at IS NULL;

-- Projets: listing par org
CREATE INDEX IF NOT EXISTS idx_projets_org_id
ON projets(organisation_id);

-- Activity logs: listing par org
CREATE INDEX IF NOT EXISTS idx_activity_logs_org_id
ON activity_logs(organisation_id);

-- Time entries: facturation/rapports par org et date
CREATE INDEX IF NOT EXISTS idx_time_entries_org_start
ON time_entries(organisation_id, start_time);

-- ============================================================
-- Migration source: 022_audit_consolidation_final.sql
-- ============================================================
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

-- ============================================================
-- Migration source: 022_fix_utilisateurs_fk_cascade.sql
-- ============================================================


-- ============================================================
-- Migration source: 023_extend_rls_critical_tables.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 023_extend_rls_critical_tables.sql
-- Extension de la Row-Level Security (RLS) à toutes les tables critiques
-- ============================================================

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'invoices', 'invoice_items', 'time_entries', 'utilisateurs', 'clients', 
        'projets', 'activity_patterns', 'activity_app_rules', 'activity_context_rules', 
        'user_sessions', 'daily_summaries', 'activity_daily_summary'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        -- Suppression préventive pour éviter les erreurs de duplication au rejeu
        EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
        EXECUTE format('CREATE POLICY %I_org_isolation ON %I
            USING (organisation_id = current_setting(''app.current_organisation_id'')::integer)
            WITH CHECK (organisation_id = current_setting(''app.current_organisation_id'')::integer)', t, t);
    END LOOP;
END $$;

-- ============================================================
-- Migration source: 023_optimize_activity_logs_index.sql
-- ============================================================
-- Index partiel pour booster les performances de l'assistant de facturation "temps réel"
-- Cet index ne contient que les lignes non agrégées, rendant la recherche instantanée.
CREATE INDEX IF NOT EXISTS idx_activity_logs_live_suggestions 
ON activity_logs (organisation_id, utilisateur_id, captured_at) 
WHERE (is_aggregated = false);

-- Analyse de la table pour mettre à jour les statistiques du planificateur
ANALYZE activity_logs;

COMMENT ON INDEX idx_activity_logs_live_suggestions IS 'Optimise le calcul des suggestions en temps réel pour le Billing Assistant.';

-- ============================================================
-- Migration source: 024_add_trgm_extension_and_index.sql
-- ============================================================
-- Activation de l'extension pour la recherche floue (Fuzzy Search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index GIN sur le nom des projets pour accélérer l'opérateur de similarité '%'
-- L'indexation utilise gin_trgm_ops pour supporter les trigrammes
CREATE INDEX IF NOT EXISTS idx_projets_nom_trgm 
ON projets USING gin (nom gin_trgm_ops);

ANALYZE projets;

COMMENT ON INDEX idx_projets_nom_trgm IS 'Optimise la détection automatique de projets via Billing Assistant.';

-- ============================================================
-- Migration source: 024_migration_execution_lock.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 024_migration_execution_lock.sql
-- Création des tables pour le suivi détaillé et le verrouillage
-- ============================================================

-- Table de suivi enrichie pour plus de télémétrie sur les déploiements
CREATE TABLE IF NOT EXISTS schema_migrations_executed (
  version VARCHAR(255) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed', 'pending')),
  
  UNIQUE(version)
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_executed_at
  ON schema_migrations_executed(executed_at DESC);

-- Table de verrouillage (Pattern Singleton)
-- On utilise un ID fixe pour s'assurer qu'une seule ligne de lock existe
CREATE TABLE IF NOT EXISTS schema_migration_lock (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  CONSTRAINT only_one_row CHECK (id = 1)
);

-- Initialisation de l'état déverrouillé
INSERT INTO schema_migration_lock (id, is_locked) 
VALUES (1, FALSE) 
ON CONFLICT DO NOTHING;

-- ============================================================
-- Migration source: 025_activity_daily_summary_unique_index.sql
-- ============================================================
-- Migration 025: prépare activity_daily_summary pour l'upsert du job d'agrégation

-- Normalise les anciennes lignes qui peuvent encore avoir des valeurs nulles.
UPDATE activity_daily_summary
SET
  app_name = COALESCE(app_name, ''),
  window_title = COALESCE(window_title, '')
WHERE app_name IS NULL
   OR window_title IS NULL;

-- Élimine les doublons éventuels avant de poser la contrainte unique.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY utilisateur_id, organisation_id, app_name, window_title, activity_date
      ORDER BY id
    ) AS rn
  FROM activity_daily_summary
)
DELETE FROM activity_daily_summary ads
USING ranked r
WHERE ads.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_daily_summary_unique_scope
ON activity_daily_summary (
  utilisateur_id,
  organisation_id,
  app_name,
  window_title,
  activity_date
);

-- ============================================================
-- Migration source: 025_add_activity_project_cache.sql
-- ============================================================
-- Table pour stocker les résultats de détection de projet (Cache)
CREATE TABLE IF NOT EXISTS activity_project_cache (
    id SERIAL PRIMARY KEY,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    window_title_hash CHAR(32) NOT NULL, -- MD5 du window_title
    suggested_project_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
    confidence INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index unique pour la recherche rapide
CREATE UNIQUE INDEX idx_activity_cache_lookup ON activity_project_cache (organisation_id, app_name, window_title_hash);

-- Activation du RLS
ALTER TABLE activity_project_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_project_cache_policy ON activity_project_cache
    USING (organisation_id = (current_setting('app.current_organisation_id')::integer));

ANALYZE activity_project_cache;

COMMENT ON TABLE activity_project_cache IS 'Cache des résultats de similarité pour éviter les calculs pg_trgm répétitifs.';

-- ============================================================
-- Migration source: 026_add_manual_flag_to_cache.sql
-- ============================================================
-- Ajout du flag is_manual pour prioriser les corrections utilisateurs
ALTER TABLE activity_project_cache ADD COLUMN is_manual BOOLEAN DEFAULT FALSE;

-- Index pour accélérer la priorité
CREATE INDEX idx_activity_cache_manual ON activity_project_cache (organisation_id, is_manual) WHERE is_manual = TRUE;

COMMENT ON COLUMN activity_project_cache.is_manual IS 'Si TRUE, cette entrée provient d''une validation manuelle et outrepasse l''IA.';

-- ============================================================
-- Migration source: 027_security_incidents_buffer.sql
-- ============================================================
-- ============================================================
-- MADSuite / TimeMonitoring
-- 027_security_incidents_buffer.sql
-- Création de la table tampon pour la consolidation des alertes
-- ============================================================

CREATE TABLE IF NOT EXISTS security_incidents_buffer (
    id SERIAL PRIMARY KEY,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- ex: 'TOKEN_REUSE_DETECTED'
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMPTZ -- NULL tant que l'email de synthèse n'est pas envoyé
);

-- 1. Index partiel CRITIQUE pour la performance du job de consolidation.
-- On n'indexe que les lignes non traitées pour garder un index minuscule et ultra-rapide.
CREATE INDEX IF NOT EXISTS idx_security_buffer_not_notified 
ON security_incidents_buffer (utilisateur_id) 
WHERE notified_at IS NULL;

-- 2. Index de maintenance pour la purge (dataRetention)
CREATE INDEX IF NOT EXISTS idx_security_buffer_purge 
ON security_incidents_buffer (organisation_id, created_at);

-- 3. Activation de la Row-Level Security (RLS)
ALTER TABLE security_incidents_buffer ENABLE ROW LEVEL SECURITY;

CREATE POLICY security_incidents_buffer_isolation ON security_incidents_buffer
    USING (organisation_id = current_setting('app.current_organisation_id')::integer)
    WITH CHECK (organisation_id = current_setting('app.current_organisation_id')::integer);

COMMENT ON TABLE security_incidents_buffer IS 'Stockage temporaire des alertes de sécurité pour envoi groupé.';
COMMENT ON COLUMN security_incidents_buffer.notified_at IS 'Horodatage de l''envoi du résumé par email. NULL = en attente.';

-- ============================================================
-- Migration source: 028_partition_security_buffer.sql
-- ============================================================
-- ============================================================
-- 028_partition_security_buffer.sql
-- Transformation de security_incidents_buffer en table partitionnée
-- ============================================================

BEGIN;

-- 1. Renommer l'ancienne table pour backup/migration
ALTER TABLE security_incidents_buffer RENAME TO security_incidents_buffer_old;
DROP INDEX IF EXISTS idx_security_buffer_not_notified;
DROP INDEX IF EXISTS idx_security_buffer_purge;

-- 2. Créer la table parente partitionnée par plage (RANGE) sur created_at
CREATE TABLE security_incidents_buffer (
    id SERIAL,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMPTZ,
    PRIMARY KEY (id, created_at) -- created_at doit être dans la PK pour le partitionnement
) PARTITION BY RANGE (created_at);

-- 3. Créer les premières partitions (ex: Juin et Juillet 2026)
CREATE TABLE security_incidents_buffer_y2026m06 PARTITION OF security_incidents_buffer
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE security_incidents_buffer_y2026m07 PARTITION OF security_incidents_buffer
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- 4. Recréer les index (ils seront automatiquement créés sur les partitions)
CREATE INDEX idx_security_buffer_not_notified 
ON security_incidents_buffer (utilisateur_id) 
WHERE notified_at IS NULL;

-- 5. Rétablir la RLS
ALTER TABLE security_incidents_buffer ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_incidents_buffer_isolation ON security_incidents_buffer
    USING (organisation_id = current_setting('app.current_organisation_id')::integer);

-- 6. Optionnel : Migrer les données des 30 derniers jours
INSERT INTO security_incidents_buffer (organisation_id, utilisateur_id, type, details, created_at, notified_at)
SELECT organisation_id, utilisateur_id, type, details, created_at, notified_at 
FROM security_incidents_buffer_old
WHERE created_at > NOW() - INTERVAL '30 days';

-- 7. Nettoyage (après vérification, tu pourras supprimer security_incidents_buffer_old)
-- DROP TABLE security_incidents_buffer_old;

COMMIT;

-- ============================================================
-- Migration source: 027_add_last_sync_at.sql
-- ============================================================
-- Ajout de la colonne de synchronisation
ALTER TABLE utilisateurs 
ADD COLUMN last_sync_at TIMESTAMPTZ;

-- Index optimisé pour le listing Admin (Multi-tenant + Tri)
CREATE INDEX idx_utilisateurs_org_sync 
ON utilisateurs (organisation_id, last_sync_at DESC)
WHERE deleted_at IS NULL;

COMMENT ON COLUMN utilisateurs.last_sync_at IS 'Date de dernière réception de logs de l''agent desktop';

-- ============================================================
-- Migration source: 029_clarify_utilisateurs_fk.sql
-- ============================================================
-- Migration 029: clarifier la contrainte organisation_id sur utilisateurs
-- Décision: ON DELETE SET NULL signifie qu'un utilisateur orphelin peut exister
-- mais ne peut plus se connecter (organisation_id est requis pour RLS).
-- Cette approche préserve l'audit trail sans laisser accès.

-- Optionnel: ajouter un CHECK pour documentar
ALTER TABLE utilisateurs ADD CONSTRAINT chk_org_context CHECK (
  -- Si l'utilisateur n'est pas soft-deleted, il DOIT avoir une organisation
  -- (l'enforcement applicatif via middleware le garantit)
  CASE 
    WHEN deleted_at IS NULL THEN organisation_id IS NOT NULL
    ELSE TRUE
  END
);

-- Commentaire pour la documentation
COMMENT ON COLUMN utilisateurs.organisation_id IS 
  'Organisation auquel l''utilisateur appartient. ON DELETE SET NULL orphelin l''utilisateur mais conserve l''audit trail. Utilisateurs orphelins ne peuvent pas se connecter (middleware requireOrganisation rejette).';

-- ============================================================
-- Migration source: 030_estimates.sql
-- ============================================================
-- 030_estimates.sql

CREATE TABLE IF NOT EXISTS estimates (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  estimate_number VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'invoiced')),
  issue_date DATE,
  valid_until DATE,
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_estimates_id_org
    UNIQUE (id, organisation_id),

  CONSTRAINT uq_estimates_number_org
    UNIQUE (organisation_id, estimate_number)
);

CREATE TABLE IF NOT EXISTS estimate_items (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description TEXT,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_rate DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_estimate_items_id_org
    UNIQUE (id, organisation_id)
);

DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at
BEFORE UPDATE ON estimates
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_estimates_org_status
ON estimates(organisation_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_client_id
ON estimates(client_id);

CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id
ON estimate_items(estimate_id);

-- ============================================================
-- Migration source: 031_invoice_estimate_link.sql
-- ============================================================
-- 031_invoice_estimate_link.sql

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS estimate_id INTEGER REFERENCES estimates(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoices.estimate_id IS 'Lien vers la soumission ayant généré cette facture, le cas échéant.';

-- ============================================================
-- Migration source: 032_expenses.sql
-- ============================================================
-- 032_expenses.sql

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  projet_id INTEGER REFERENCES projets(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  distance DECIMAL(10, 2),
  rate_per_unit DECIMAL(10, 2),
  is_billable BOOLEAN DEFAULT TRUE,
  is_billed BOOLEAN DEFAULT FALSE,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  
  CONSTRAINT uq_expenses_id_org UNIQUE (id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_projet_id ON expenses(projet_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org_id ON expenses(organisation_id);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses;
CREATE TRIGGER trg_expenses_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- ============================================================
-- Migration source: 033_billing_reminders.sql
-- ============================================================
-- Migration 033_billing_reminders.sql

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS reminders_sent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS reminders_sent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

-- ============================================================
-- Migration source: 033_project_budgets.sql
-- ============================================================
-- 033_project_budgets.sql

ALTER TABLE projets 
  ADD COLUMN IF NOT EXISTS budget_hours DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_amount DECIMAL(12, 2) DEFAULT 0;

COMMENT ON COLUMN projets.budget_hours IS 'Budget en heures pour le projet (0 = pas de budget)';
COMMENT ON COLUMN projets.budget_amount IS 'Budget en montant ($) pour le projet (0 = pas de budget)';

-- ============================================================
-- Migration source: 033_stripe_subscriptions.sql
-- ============================================================
-- 033_stripe_subscriptions.sql

ALTER TABLE organisations 
ADD COLUMN stripe_customer_id VARCHAR(255),
ADD COLUMN stripe_subscription_id VARCHAR(255),
ADD COLUMN plan_type VARCHAR(50) DEFAULT 'free',
ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'trialing',
ADD COLUMN trial_ends_at TIMESTAMPTZ;

-- Index pour accélérer les recherches lors des webhooks Stripe
CREATE INDEX idx_org_stripe_customer_id ON organisations(stripe_customer_id);
CREATE INDEX idx_org_stripe_subscription_id ON organisations(stripe_subscription_id);

-- ============================================================
-- Migration source: 034_calendar_sync.sql
-- ============================================================
-- 034_calendar_sync.sql

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS ical_feed_url TEXT;

COMMENT ON COLUMN utilisateurs.ical_feed_url IS 'URL secrète iCal (ex: Google Calendar) pour la synchronisation en lecture seule';

-- ============================================================
-- Migration source: 034_client_portal.sql
-- ============================================================
-- 034_client_portal.sql
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid() UNIQUE;

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid() UNIQUE;

-- ============================================================
-- Migration source: 034_interac_settings.sql
-- ============================================================
-- 034_interac_settings.sql

ALTER TABLE organisations
ADD COLUMN interac_email VARCHAR(255),
ADD COLUMN interac_question VARCHAR(255);

-- ============================================================
-- Migration source: 035_invoice_payments.sql
-- ============================================================
-- 035_invoice_payments.sql
ALTER TABLE organisations
ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);

-- ============================================================
-- Migration source: 035_timesheet_approvals.sql
-- ============================================================
-- 035_timesheet_approvals.sql

ALTER TABLE time_entries 
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));

COMMENT ON COLUMN time_entries.status IS 'Statut de lapprobation (draft = brouillon, submitted = soumis, approved = approuvé, rejected = rejeté)';

-- ============================================================
-- Migration source: 036_smart_billing.sql
-- ============================================================
-- 036_smart_billing.sql

ALTER TABLE projets 
  ADD COLUMN IF NOT EXISTS billing_increment INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_rounding_type VARCHAR(10) DEFAULT 'exact' CHECK (billing_rounding_type IN ('exact', 'up', 'nearest'));

COMMENT ON COLUMN projets.billing_increment IS 'Incrément de facturation en minutes (ex: 1, 5, 15, 30)';
COMMENT ON COLUMN projets.billing_rounding_type IS 'Type d''arrondi de facturation (exact, up, nearest)';

-- ============================================================
-- Migration source: 037_estimate_signature.sql
-- ============================================================
-- 037_estimate_signature.sql
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_ip VARCHAR(50);
