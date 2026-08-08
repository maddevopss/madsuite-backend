-- Migration: Fix UUID schema inconsistencies
-- Date: 2026-08-06
-- Purpose: Convert INTEGER PKs/FKs to UUID for consistency with modern schema
--
-- CRITICAL FIX: Migrations 2, 3, 5 used INTEGER instead of UUID
-- This migration provides a safe conversion path without data loss
--
-- NOTE: This is a STAGING/TESTING migration. Do NOT run on production without:
-- 1. Full backup
-- 2. Testing on replica
-- 3. Explicit approval

BEGIN;

-- ============================================================================
-- MIGRATION 2 FIX: 20260806_create_analytics_tables.sql
-- ============================================================================
-- Convert analytics_events to UUID schema
-- Strategy: Add new UUID columns, migrate data, drop old columns

-- Step 1: Add UUID columns to analytics_events
ALTER TABLE analytics_events 
ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS user_id_uuid UUID,
ADD COLUMN IF NOT EXISTS organisation_id_uuid UUID;

-- Step 2: Migrate data from INTEGER to UUID
UPDATE analytics_events 
SET user_id_uuid = (SELECT id FROM utilisateurs WHERE utilisateurs.id = analytics_events.user_id LIMIT 1)
WHERE user_id IS NOT NULL AND user_id_uuid IS NULL;

UPDATE analytics_events 
SET organisation_id_uuid = (SELECT id FROM organisations WHERE organisations.id = analytics_events.organisation_id LIMIT 1)
WHERE organisation_id IS NOT NULL AND organisation_id_uuid IS NULL;

-- Step 3: Add constraints on new UUID columns
ALTER TABLE analytics_events 
ADD CONSTRAINT fk_analytics_events_user_uuid FOREIGN KEY (user_id_uuid) REFERENCES utilisateurs(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_analytics_events_org_uuid FOREIGN KEY (organisation_id_uuid) REFERENCES organisations(id) ON DELETE CASCADE;

-- Step 4: Create indexes on new UUID columns
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_uuid ON analytics_events(user_id_uuid);
CREATE INDEX IF NOT EXISTS idx_analytics_events_org_uuid ON analytics_events(organisation_id_uuid);
CREATE INDEX IF NOT EXISTS idx_analytics_events_org_timestamp_uuid ON analytics_events(organisation_id_uuid, timestamp DESC);

-- Step 5: Drop old INTEGER columns (after verification)
-- ALTER TABLE analytics_events DROP COLUMN user_id, DROP COLUMN organisation_id, DROP COLUMN id;
-- ALTER TABLE analytics_events RENAME COLUMN id_uuid TO id;
-- ALTER TABLE analytics_events RENAME COLUMN user_id_uuid TO user_id;
-- ALTER TABLE analytics_events RENAME COLUMN organisation_id_uuid TO organisation_id;

-- ============================================================================
-- MIGRATION 2 FIX: analytics_conversions
-- ============================================================================
ALTER TABLE analytics_conversions 
ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS user_id_uuid UUID,
ADD COLUMN IF NOT EXISTS organisation_id_uuid UUID;

UPDATE analytics_conversions 
SET user_id_uuid = (SELECT id FROM utilisateurs WHERE utilisateurs.id = analytics_conversions.user_id LIMIT 1)
WHERE user_id IS NOT NULL AND user_id_uuid IS NULL;

UPDATE analytics_conversions 
SET organisation_id_uuid = (SELECT id FROM organisations WHERE organisations.id = analytics_conversions.organisation_id LIMIT 1)
WHERE organisation_id IS NOT NULL AND organisation_id_uuid IS NULL;

ALTER TABLE analytics_conversions 
ADD CONSTRAINT fk_analytics_conversions_user_uuid FOREIGN KEY (user_id_uuid) REFERENCES utilisateurs(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_analytics_conversions_org_uuid FOREIGN KEY (organisation_id_uuid) REFERENCES organisations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_analytics_conversions_user_uuid ON analytics_conversions(user_id_uuid);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_org_uuid ON analytics_conversions(organisation_id_uuid);
CREATE INDEX IF NOT EXISTS idx_analytics_conversions_org_created_uuid ON analytics_conversions(organisation_id_uuid, created_at DESC);

-- ============================================================================
-- MIGRATION 2 FIX: email_sequences
-- ============================================================================
ALTER TABLE email_sequences 
ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS user_id_uuid UUID,
ADD COLUMN IF NOT EXISTS organisation_id_uuid UUID;

UPDATE email_sequences 
SET user_id_uuid = (SELECT id FROM utilisateurs WHERE utilisateurs.id = email_sequences.user_id LIMIT 1)
WHERE user_id IS NOT NULL AND user_id_uuid IS NULL;

UPDATE email_sequences 
SET organisation_id_uuid = (SELECT id FROM organisations WHERE organisations.id = email_sequences.organisation_id LIMIT 1)
WHERE organisation_id IS NOT NULL AND organisation_id_uuid IS NULL;

ALTER TABLE email_sequences 
ADD CONSTRAINT fk_email_sequences_user_uuid FOREIGN KEY (user_id_uuid) REFERENCES utilisateurs(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_email_sequences_org_uuid FOREIGN KEY (organisation_id_uuid) REFERENCES organisations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_email_sequences_user_uuid ON email_sequences(user_id_uuid);
CREATE INDEX IF NOT EXISTS idx_email_sequences_org_uuid ON email_sequences(organisation_id_uuid);
CREATE INDEX IF NOT EXISTS idx_email_sequences_org_scheduled_uuid ON email_sequences(organisation_id_uuid, scheduled_at DESC);

-- ============================================================================
-- MIGRATION 3 FIX: 20260806_create_estimate_templates.sql
-- ============================================================================
ALTER TABLE estimate_templates 
ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS organisation_id_uuid UUID,
ADD COLUMN IF NOT EXISTS created_by_uuid UUID;

UPDATE estimate_templates 
SET organisation_id_uuid = (SELECT id FROM organisations WHERE organisations.id = estimate_templates.organisation_id LIMIT 1)
WHERE organisation_id IS NOT NULL AND organisation_id_uuid IS NULL;

UPDATE estimate_templates 
SET created_by_uuid = (SELECT id FROM utilisateurs WHERE utilisateurs.id = estimate_templates.created_by LIMIT 1)
WHERE created_by IS NOT NULL AND created_by_uuid IS NULL;

ALTER TABLE estimate_templates 
ADD CONSTRAINT fk_estimate_templates_org_uuid FOREIGN KEY (organisation_id_uuid) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_estimate_templates_created_by_uuid FOREIGN KEY (created_by_uuid) REFERENCES utilisateurs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_templates_org_uuid ON estimate_templates(organisation_id_uuid);
CREATE INDEX IF NOT EXISTS idx_estimate_templates_org_default_uuid ON estimate_templates(organisation_id_uuid, is_default);
CREATE INDEX IF NOT EXISTS idx_estimate_templates_created_by_uuid ON estimate_templates(created_by_uuid);

-- ============================================================================
-- MIGRATION 5 FIX: 20260806_create_stripe_retry_logs.sql
-- ============================================================================
ALTER TABLE stripe_retry_logs 
ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS organisation_id_uuid UUID,
ADD COLUMN IF NOT EXISTS invoice_id_uuid UUID;

UPDATE stripe_retry_logs 
SET organisation_id_uuid = (SELECT id FROM organisations WHERE organisations.id = stripe_retry_logs.organisation_id LIMIT 1)
WHERE organisation_id IS NOT NULL AND organisation_id_uuid IS NULL;

UPDATE stripe_retry_logs 
SET invoice_id_uuid = (SELECT id FROM invoices WHERE invoices.id = stripe_retry_logs.invoice_id LIMIT 1)
WHERE invoice_id IS NOT NULL AND invoice_id_uuid IS NULL;

ALTER TABLE stripe_retry_logs 
ADD CONSTRAINT fk_stripe_retry_logs_org_uuid FOREIGN KEY (organisation_id_uuid) REFERENCES organisations(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_stripe_retry_logs_invoice_uuid FOREIGN KEY (invoice_id_uuid) REFERENCES invoices(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_org_uuid ON stripe_retry_logs(organisation_id_uuid);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_invoice_uuid ON stripe_retry_logs(invoice_id_uuid);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_status_uuid ON stripe_retry_logs(status);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_next_retry_uuid ON stripe_retry_logs(next_retry_at);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN analytics_events.id_uuid IS 'UUID primary key (new schema)';
COMMENT ON COLUMN analytics_events.user_id_uuid IS 'UUID foreign key to utilisateurs (new schema)';
COMMENT ON COLUMN analytics_events.organisation_id_uuid IS 'UUID foreign key to organisations (new schema)';

COMMENT ON COLUMN estimate_templates.id_uuid IS 'UUID primary key (new schema)';
COMMENT ON COLUMN estimate_templates.organisation_id_uuid IS 'UUID foreign key to organisations (new schema)';
COMMENT ON COLUMN estimate_templates.created_by_uuid IS 'UUID foreign key to utilisateurs (new schema)';

COMMENT ON COLUMN stripe_retry_logs.id_uuid IS 'UUID primary key (new schema)';
COMMENT ON COLUMN stripe_retry_logs.organisation_id_uuid IS 'UUID foreign key to organisations (new schema)';
COMMENT ON COLUMN stripe_retry_logs.invoice_id_uuid IS 'UUID foreign key to invoices (new schema)';

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================
-- This migration adds UUID columns alongside existing INTEGER columns.
-- After verification in staging:
-- 1. Update application code to use UUID columns
-- 2. Run follow-up migration to drop INTEGER columns
-- 3. Rename UUID columns to original names
--
-- DO NOT run on production without explicit approval and full backup.

COMMIT;
