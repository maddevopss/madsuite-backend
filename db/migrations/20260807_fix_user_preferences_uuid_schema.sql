-- Migration: Fix user_preferences UUID schema inconsistencies
-- Date: 2026-08-07
-- Purpose: Convert UUID PKs/FKs to INTEGER to match organisations/utilisateurs schema
-- 
-- CRITICAL FIX: Migration 20260806_create_user_preferences.sql used UUID instead of INTEGER
-- This migration provides a safe conversion path without data loss
-- ROLLBACK-ACKNOWLEDGED: UUID columns are removed only after every organisation/user mapping is validated; the transaction aborts on any unmapped row.
--
-- Tables affected:
-- - user_preferences
-- - user_behavior_tracking
-- - personalization_settings

BEGIN;

-- ============================================================================
-- FIX: user_preferences
-- ============================================================================
ALTER TABLE user_preferences 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER,
ADD COLUMN IF NOT EXISTS user_id_new INTEGER;

UPDATE user_preferences 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = user_preferences.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

UPDATE user_preferences 
SET user_id_new = (SELECT id FROM utilisateurs WHERE utilisateurs.id::TEXT = user_preferences.user_id::TEXT LIMIT 1)
WHERE user_id_new IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_preferences
    WHERE organisation_id_new IS NULL OR user_id_new IS NULL
  ) THEN
    RAISE EXCEPTION 'user_preferences UUID conversion incomplete';
  END IF;
END $$;

ALTER TABLE user_preferences 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE,
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE user_preferences 
RENAME COLUMN id_new TO id;

ALTER TABLE user_preferences 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE user_preferences 
RENAME COLUMN user_id_new TO user_id;

ALTER TABLE user_preferences 
ADD CONSTRAINT pk_user_preferences PRIMARY KEY (id),
ADD CONSTRAINT fk_user_preferences_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
ADD CONSTRAINT uq_user_preferences_org_user UNIQUE(organisation_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_preferences_org ON user_preferences(organisation_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_org_user ON user_preferences(organisation_id, user_id);

DROP POLICY IF EXISTS user_preferences_rls ON user_preferences;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_preferences_rls ON user_preferences
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- ============================================================================
-- FIX: user_behavior_tracking
-- ============================================================================
ALTER TABLE user_behavior_tracking 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER,
ADD COLUMN IF NOT EXISTS user_id_new INTEGER;

UPDATE user_behavior_tracking 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = user_behavior_tracking.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

UPDATE user_behavior_tracking 
SET user_id_new = (SELECT id FROM utilisateurs WHERE utilisateurs.id::TEXT = user_behavior_tracking.user_id::TEXT LIMIT 1)
WHERE user_id_new IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_behavior_tracking
    WHERE organisation_id_new IS NULL OR user_id_new IS NULL
  ) THEN
    RAISE EXCEPTION 'user_behavior_tracking UUID conversion incomplete';
  END IF;
END $$;

ALTER TABLE user_behavior_tracking 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE,
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE user_behavior_tracking 
RENAME COLUMN id_new TO id;

ALTER TABLE user_behavior_tracking 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE user_behavior_tracking 
RENAME COLUMN user_id_new TO user_id;

ALTER TABLE user_behavior_tracking 
ADD CONSTRAINT pk_user_behavior_tracking PRIMARY KEY (id),
ADD CONSTRAINT fk_user_behavior_tracking_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_user_behavior_tracking_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_behavior_tracking_org ON user_behavior_tracking(organisation_id);
CREATE INDEX IF NOT EXISTS idx_user_behavior_tracking_user ON user_behavior_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_user_behavior_tracking_timestamp ON user_behavior_tracking(timestamp DESC);

DROP POLICY IF EXISTS user_behavior_tracking_rls ON user_behavior_tracking;
ALTER TABLE user_behavior_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_behavior_tracking_rls ON user_behavior_tracking
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- ============================================================================
-- FIX: personalization_settings
-- ============================================================================
ALTER TABLE personalization_settings 
ADD COLUMN IF NOT EXISTS id_new BIGSERIAL,
ADD COLUMN IF NOT EXISTS organisation_id_new INTEGER,
ADD COLUMN IF NOT EXISTS user_id_new INTEGER;

UPDATE personalization_settings 
SET organisation_id_new = (SELECT id FROM organisations WHERE organisations.id::TEXT = personalization_settings.organisation_id::TEXT LIMIT 1)
WHERE organisation_id_new IS NULL;

UPDATE personalization_settings 
SET user_id_new = (SELECT id FROM utilisateurs WHERE utilisateurs.id::TEXT = personalization_settings.user_id::TEXT LIMIT 1)
WHERE user_id_new IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM personalization_settings
    WHERE organisation_id_new IS NULL OR user_id_new IS NULL
  ) THEN
    RAISE EXCEPTION 'personalization_settings UUID conversion incomplete';
  END IF;
END $$;

ALTER TABLE personalization_settings 
DROP COLUMN IF EXISTS id CASCADE,
DROP COLUMN IF EXISTS organisation_id CASCADE,
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE personalization_settings 
RENAME COLUMN id_new TO id;

ALTER TABLE personalization_settings 
RENAME COLUMN organisation_id_new TO organisation_id;

ALTER TABLE personalization_settings 
RENAME COLUMN user_id_new TO user_id;

ALTER TABLE personalization_settings 
ADD CONSTRAINT pk_personalization_settings PRIMARY KEY (id),
ADD CONSTRAINT fk_personalization_settings_org FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_personalization_settings_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
ADD CONSTRAINT uq_personalization_settings_org_user UNIQUE(organisation_id, user_id);

CREATE INDEX IF NOT EXISTS idx_personalization_settings_org ON personalization_settings(organisation_id);
CREATE INDEX IF NOT EXISTS idx_personalization_settings_user ON personalization_settings(user_id);

DROP POLICY IF EXISTS personalization_settings_rls ON personalization_settings;
ALTER TABLE personalization_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY personalization_settings_rls ON personalization_settings
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

COMMIT;
