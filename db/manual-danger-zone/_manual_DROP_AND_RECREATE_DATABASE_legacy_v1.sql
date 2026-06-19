-- DANGER: manual legacy v1 reset. Never use for schema upgrades.
-- The source of truth is ../migrations/.
DROP DATABASE IF EXISTS "madsuite";
CREATE DATABASE "madsuite";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organisations (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE utilisateurs (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    mot_de_passe TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'employe',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
    role_org VARCHAR(30) DEFAULT 'user',
    CONSTRAINT chk_role CHECK (role IN ('admin', 'employe'))
);

CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(255) NOT NULL,
    hourly_rate_defaut DECIMAL(10, 2) CHECK (hourly_rate_defaut >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE
);

CREATE TABLE projets (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    nom VARCHAR(255) NOT NULL,
    description TEXT,
    date_fin DATE,
    budget DECIMAL(10,2) CHECK (budget >= 0),
    taux_horaire DECIMAL(10, 2) CHECK (taux_horaire >= 0),
    status VARCHAR(50) DEFAULT 'actif' CHECK (status IN ('actif', 'pause', 'termine', 'archive')),
    couleur VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
    CONSTRAINT fk_client
        FOREIGN KEY (client_id)
        REFERENCES clients(id)
        ON DELETE CASCADE
);

CREATE TABLE time_entries (
    id SERIAL PRIMARY KEY,
    projet_id INTEGER NOT NULL,
    utilisateur_id INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    description TEXT,
    hourly_rate_used DECIMAL(10,2) CHECK (hourly_rate_used >= 0),
    is_billed BOOLEAN DEFAULT FALSE,
    distance_km DECIMAL(10, 2) DEFAULT 0 CHECK (distance_km >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,

    CONSTRAINT fk_projet
        FOREIGN KEY (projet_id)
        REFERENCES projets(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_utilisateur
        FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_time
        CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE TABLE activity_logs (
    id SERIAL PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL,
    app_name VARCHAR(255),
    window_title TEXT,
    is_idle BOOLEAN DEFAULT FALSE,
    idle_seconds INTEGER DEFAULT 0 CHECK (idle_seconds >= 0),
    activity_signature TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (type IN ('active', 'background')),
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
    project_suggestion_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
    confidence_score INTEGER DEFAULT 0,
    activity_category VARCHAR(80),
    CONSTRAINT fk_user_log
        FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_daily_summary (
    id SERIAL PRIMARY KEY,

    utilisateur_id INTEGER NOT NULL,
    app_name VARCHAR(255),
    window_title TEXT,

    total_seconds INTEGER DEFAULT 0,
    activity_date DATE NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_activity_summary_user
        FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_daily_activity
        UNIQUE (utilisateur_id, app_name, window_title, activity_date)
);

CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    utilisateur_id INTEGER REFERENCES utilisateurs(id),
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logout_time TIMESTAMP,
    duration_seconds INTEGER,
    active BOOLEAN DEFAULT true,
    ip_address VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_patterns (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  projet_id INTEGER REFERENCES projets(id) ON DELETE CASCADE,
  keyword VARCHAR(255) NOT NULL,
  weight INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
  feedback_type VARCHAR(30) NOT NULL DEFAULT 'confirmed' CHECK (feedback_type IN ('confirmed', 'rejected', 'corrected')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_context_rules (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  nom VARCHAR(150) NOT NULL,
  required_patterns TEXT[] NOT NULL DEFAULT '{}',
  category VARCHAR(80) NOT NULL,
  tag VARCHAR(80),
  confidence INTEGER DEFAULT 80 CHECK (confidence >= 0 AND confidence <= 100),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  total_seconds INTEGER DEFAULT 0,
  billable_seconds INTEGER DEFAULT 0,
  summary_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organisation_id, utilisateur_id, summary_date)
);

CREATE TABLE IF NOT EXISTS billing_ai_suggestions (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE CASCADE,
  original_description TEXT,
  suggested_description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_utilisateurs_email ON utilisateurs(email);
CREATE INDEX IF NOT EXISTS idx_projets_client_id ON projets(client_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_projet_id ON time_entries(projet_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_user ON time_entries(start_time, utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_start ON time_entries(projet_id, start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_start ON time_entries(utilisateur_id, start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_client_lookup ON projets(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(type);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id on user_sessions(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_one_active_timer_per_user ON time_entries (utilisateur_id) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_logs_signature ON activity_logs (utilisateur_id, activity_signature) WHERE activity_signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_time ON activity_logs(utilisateur_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_activity_daily_summary_user_date ON activity_daily_summary(utilisateur_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_deleted_at ON utilisateurs (deleted_at);
CREATE INDEX IF NOT EXISTS idx_activity_app_rules_org_active ON activity_app_rules(organisation_id, active);
CREATE INDEX IF NOT EXISTS idx_activity_feedback_user_date ON activity_feedback(utilisateur_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_context_rules_org_active ON activity_context_rules(organisation_id, active);
CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(activity_category);
CREATE INDEX IF NOT EXISTS idx_activity_patterns_projet_id ON activity_patterns(projet_id);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(utilisateur_id, summary_date);



-- Utilisateurs non seedes en SQL.
-- Utiliser backend/seed.js pour creer un compte avec un vrai hash bcrypt.



-- CREATE UNIQUE INDEX idx_one_active_timer_per_user
--   ON time_entries (utilisateur_id)
--   WHERE end_time IS NULL;
