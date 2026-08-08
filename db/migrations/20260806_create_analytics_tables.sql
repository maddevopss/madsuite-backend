-- Migration: Create analytics tables
-- Date: 2026-08-06
-- Purpose: Support for analytics and A/B testing in Phase 5.3
-- FIXED: Added RLS policies, changed INTEGER to match organisations.id type

BEGIN;

-- Table pour les événements
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_name VARCHAR(255) NOT NULL,
  properties JSONB DEFAULT '{}',
  event_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes pour performance
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_org ON analytics_events(organisation_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(event_timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_events_org_timestamp ON analytics_events(organisation_id, event_timestamp DESC);

-- RLS Policy for analytics_events
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_events_org_isolation ON analytics_events
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Table pour les conversions
CREATE TABLE IF NOT EXISTS analytics_conversions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  test_name VARCHAR(255) NOT NULL,
  variant VARCHAR(10) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes pour performance
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_user ON analytics_conversions(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_org ON analytics_conversions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_test ON analytics_conversions(test_name);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_variant ON analytics_conversions(variant);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_created ON analytics_conversions(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_org_created ON analytics_conversions(organisation_id, created_at DESC);

-- RLS Policy for analytics_conversions
ALTER TABLE analytics_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_conversions_org_isolation ON analytics_conversions
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Table pour les email sequences
CREATE TABLE IF NOT EXISTS email_sequences (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  sequence_name VARCHAR(255) NOT NULL,
  email_subject VARCHAR(255) NOT NULL,
  email_template VARCHAR(255) NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, failed
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes pour performance
CREATE INDEX IF NOT EXISTS idx_email_sequences_user ON email_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_org ON email_sequences(organisation_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_status ON email_sequences(status);
CREATE INDEX IF NOT EXISTS idx_email_sequences_scheduled ON email_sequences(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_sequences_sequence ON email_sequences(sequence_name);
CREATE INDEX IF NOT EXISTS idx_email_sequences_org_scheduled ON email_sequences(organisation_id, scheduled_at DESC);

-- RLS Policy for email_sequences
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_sequences_org_isolation ON email_sequences
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

COMMIT;
