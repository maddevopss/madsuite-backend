-- Migration: 044_cognitive_history.sql
-- Description: Add tables for Cognitive State Engine V1 persistance

CREATE TABLE IF NOT EXISTS cognitive_state_events (
    id SERIAL PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
    state VARCHAR(50) NOT NULL, -- 'flow', 'deep_focus', 'friction', 'fatigue'
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_minutes INTEGER DEFAULT 0,
    projet_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
    confidence DECIMAL(5,2)
);

CREATE INDEX IF NOT EXISTS idx_cognitive_events_user_time ON cognitive_state_events(utilisateur_id, started_at);

CREATE TABLE IF NOT EXISTS daily_cognitive_metrics (
    id SERIAL PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    flow_minutes INTEGER DEFAULT 0,
    deep_focus_minutes INTEGER DEFAULT 0,
    friction_minutes INTEGER DEFAULT 0,
    fatigue_minutes INTEGER DEFAULT 0,
    
    context_switches INTEGER DEFAULT 0,
    longest_session_minutes INTEGER DEFAULT 0,
    total_focus_minutes INTEGER DEFAULT 0,
    
    dominant_project_id INTEGER REFERENCES projets(id) ON DELETE SET NULL,
    
    UNIQUE (utilisateur_id, date)
);
