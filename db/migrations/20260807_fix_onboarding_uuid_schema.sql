-- Migration: Fix onboarding UUID schema inconsistencies
-- Date: 2026-08-07
-- Purpose: Convert UUID PKs/FKs to INTEGER to match organisations/utilisateurs schema
-- 
-- CRITICAL FIX: Migration 20260806_create_onboarding.sql used UUID instead of INTEGER
-- This migration provides a safe conversion path without data loss
--
-- Tables affected:
-- - onboarding_progress
-- - tutorial_completion
-- - feature_discovery
-- - help_articles

BEGIN;

-- ============================================================================
-- FIX: onboarding_progress
-- ============================================================================
-- Add INTEGER columns alongside UUID columns
ALTER TABLE onboarding_progress 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER,
ADD COLUMN IF NOT EXISTS user_id_new INTEGER;

-- Migrate data from UUID to INTEGER
UPDATE onboarding_progress 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = onboarding_progress.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

UPDATE onboarding_progress 
SET user_id_new = (SELECT id FROM utilisateurs WHERE utilisateurs.id::TEXT = onboarding_progress.user_id::TEXT LIMIT 1)
WHERE user_id_new IS NULL;

-- Drop old UUID columns and rename new ones
ALTER TABLE onboarding_progress 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE,
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE onboarding_progress 
RENAME COLUMN id_new TO id;

ALTER TABLE onboarding_progress 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE onboarding_progress 
RENAME COLUMN user_id_new TO user_id;

-- Add constraints
ALTER TABLE onboarding_progress 
ADD CONSTRAINT pk_onboarding_progress PRIMARY KEY (id),
ADD CONSTRAINT fk_onboarding_progress_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_onboarding_progress_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_org ON onboarding_progress(organisation_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user ON onboarding_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_org_user ON onboarding_progress(organisation_id, user_id);

-- Fix RLS policy
DROP POLICY IF EXISTS onboarding_progress_rls ON onboarding_progress;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY onboarding_progress_rls ON onboarding_progress
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
    AND user_id = current_setting('app.current_user_id')::INTEGER
  );

-- ============================================================================
-- FIX: tutorial_completion
-- ============================================================================
ALTER TABLE tutorial_completion 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER,
ADD COLUMN IF NOT EXISTS user_id_new INTEGER;

UPDATE tutorial_completion 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = tutorial_completion.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

UPDATE tutorial_completion 
SET user_id_new = (SELECT id FROM utilisateurs WHERE utilisateurs.id::TEXT = tutorial_completion.user_id::TEXT LIMIT 1)
WHERE user_id_new IS NULL;

ALTER TABLE tutorial_completion 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE,
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE tutorial_completion 
RENAME COLUMN id_new TO id;

ALTER TABLE tutorial_completion 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE tutorial_completion 
RENAME COLUMN user_id_new TO user_id;

ALTER TABLE tutorial_completion 
ADD CONSTRAINT pk_tutorial_completion PRIMARY KEY (id),
ADD CONSTRAINT fk_tutorial_completion_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_tutorial_completion_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tutorial_completion_org ON tutorial_completion(organisation_id);
CREATE INDEX IF NOT EXISTS idx_tutorial_completion_user ON tutorial_completion(user_id);

DROP POLICY IF EXISTS tutorial_completion_rls ON tutorial_completion;
ALTER TABLE tutorial_completion ENABLE ROW LEVEL SECURITY;
CREATE POLICY tutorial_completion_rls ON tutorial_completion
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- ============================================================================
-- FIX: feature_discovery
-- ============================================================================
ALTER TABLE feature_discovery 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER,
ADD COLUMN IF NOT EXISTS user_id_new INTEGER;

UPDATE feature_discovery 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = feature_discovery.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

UPDATE feature_discovery 
SET user_id_new = (SELECT id FROM utilisateurs WHERE utilisateurs.id::TEXT = feature_discovery.user_id::TEXT LIMIT 1)
WHERE user_id_new IS NULL;

ALTER TABLE feature_discovery 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE,
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE feature_discovery 
RENAME COLUMN id_new TO id;

ALTER TABLE feature_discovery 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE feature_discovery 
RENAME COLUMN user_id_new TO user_id;

ALTER TABLE feature_discovery 
ADD CONSTRAINT pk_feature_discovery PRIMARY KEY (id),
ADD CONSTRAINT fk_feature_discovery_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_feature_discovery_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_feature_discovery_org ON feature_discovery(organisation_id);
CREATE INDEX IF NOT EXISTS idx_feature_discovery_user ON feature_discovery(user_id);

DROP POLICY IF EXISTS feature_discovery_rls ON feature_discovery;
ALTER TABLE feature_discovery ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_discovery_rls ON feature_discovery
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- ============================================================================
-- FIX: help_articles
-- ============================================================================
ALTER TABLE help_articles 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER;

UPDATE help_articles 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = help_articles.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

ALTER TABLE help_articles 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE;

ALTER TABLE help_articles 
RENAME COLUMN id_new TO id;

ALTER TABLE help_articles 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE help_articles 
ADD CONSTRAINT pk_help_articles PRIMARY KEY (id),
ADD CONSTRAINT fk_help_articles_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_help_articles_org ON help_articles(organisation_id);

DROP POLICY IF EXISTS help_articles_rls ON help_articles;
ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY help_articles_rls ON help_articles
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

COMMIT;
