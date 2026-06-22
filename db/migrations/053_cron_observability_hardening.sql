-- Migration 053: Cron Observability Hardening
-- Adds error_summary column for PARTIAL_SUCCESS states

ALTER TABLE cron_execution_logs ADD COLUMN IF NOT EXISTS error_summary JSONB;
