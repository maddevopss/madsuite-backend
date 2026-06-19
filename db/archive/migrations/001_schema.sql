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
    CHECK (role IN ('admin', 'employe')),

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
