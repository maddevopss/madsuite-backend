-- Migration 065: Repair Critical Runtime Schema
-- Idempotent reconstruction of critical tables that may be missing
-- Sources: 034_retention_phase3.sql, 050_outbox_events.sql, 051_cron_execution_logs.sql,
--          052_outbox_harden.sql, 053_cron_observability_hardening.sql, 056_cron_keep_for_debug_flag.sql

-- ============================================================================
-- TABLE: notifications (from 034_retention_phase3.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_notifications_id_org
    UNIQUE (id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
ON notifications(utilisateur_id, is_read);

-- ============================================================================
-- TABLE: outbox_events (from 050_outbox_events.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE
);

-- Columns from 052_outbox_harden.sql
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Indexes from 050_outbox_events.sql
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status) WHERE status = 'pending';

-- Index from 052_outbox_harden.sql
CREATE INDEX IF NOT EXISTS idx_outbox_events_retry ON outbox_events(status, next_retry_at) WHERE status = 'pending';

-- ============================================================================
-- TABLE: cron_execution_logs (from 051_cron_execution_logs.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cron_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name VARCHAR(100) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL, -- 'STARTED', 'SUCCESS', 'FAILED'
    error_message TEXT
);

-- Column from 053_cron_observability_hardening.sql
ALTER TABLE cron_execution_logs ADD COLUMN IF NOT EXISTS error_summary JSONB;

-- Column from 056_cron_keep_for_debug_flag.sql
ALTER TABLE cron_execution_logs ADD COLUMN IF NOT EXISTS keep_for_debug BOOLEAN DEFAULT false;

-- Indexes from 051_cron_execution_logs.sql
CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_job_name ON cron_execution_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_status ON cron_execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_started_at ON cron_execution_logs(started_at);
