-- Migration: Fix analytics tables - Add RLS and organisation_id
-- Date: 2026-08-06
-- Purpose: Add missing RLS policies and organisation_id to analytics_tables for multi-tenant isolation
-- 
-- CRITICAL FIX: The original 20260806_create_analytics_tables.sql was missing:
-- 1. RLS policies on all tables
-- 2. organisation_id on analytics_events (only has user_id and organisation_id FK)
-- 3. Proper multi-tenant isolation

BEGIN;

-- ============================================================================
-- 1. ADD RLS TO analytics_events
-- ============================================================================
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_events_org_isolation ON analytics_events
  FOR SELECT
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY analytics_events_org_isolation_insert ON analytics_events
  FOR INSERT
  WITH CHECK (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY analytics_events_org_isolation_update ON analytics_events
  FOR UPDATE
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY analytics_events_org_isolation_delete ON analytics_events
  FOR DELETE
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

-- ============================================================================
-- 2. ADD RLS TO analytics_conversions
-- ============================================================================
-- First, add organisation_id column if missing
ALTER TABLE analytics_conversions 
ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_org 
  ON analytics_conversions(organisation_id);

-- Enable RLS
ALTER TABLE analytics_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_conversions_org_isolation ON analytics_conversions
  FOR SELECT
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY analytics_conversions_org_isolation_insert ON analytics_conversions
  FOR INSERT
  WITH CHECK (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY analytics_conversions_org_isolation_update ON analytics_conversions
  FOR UPDATE
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY analytics_conversions_org_isolation_delete ON analytics_conversions
  FOR DELETE
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

-- ============================================================================
-- 3. ADD RLS TO email_sequences
-- ============================================================================
-- First, add organisation_id column if missing
ALTER TABLE email_sequences 
ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_email_sequences_org 
  ON email_sequences(organisation_id);

-- Enable RLS
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_sequences_org_isolation ON email_sequences
  FOR SELECT
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY email_sequences_org_isolation_insert ON email_sequences
  FOR INSERT
  WITH CHECK (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY email_sequences_org_isolation_update ON email_sequences
  FOR UPDATE
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

CREATE POLICY email_sequences_org_isolation_delete ON email_sequences
  FOR DELETE
  USING (organisation_id = current_setting('app.current_org_id')::INTEGER);

-- ============================================================================
-- 4. COMPOSITE INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_analytics_events_org_timestamp 
  ON analytics_events(organisation_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_conversions_org_created 
  ON analytics_conversions(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_sequences_org_scheduled 
  ON email_sequences(organisation_id, scheduled_at DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE analytics_events IS 'Analytics events with multi-tenant RLS isolation';
COMMENT ON TABLE analytics_conversions IS 'A/B test conversions with multi-tenant RLS isolation';
COMMENT ON TABLE email_sequences IS 'Email sequences with multi-tenant RLS isolation';

COMMIT;
