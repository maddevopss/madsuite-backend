-- Migration 015: Délais de rétention configurables par organisation

ALTER TABLE organisations
ADD COLUMN IF NOT EXISTS retention_activity_logs_days INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS retention_summary_days INTEGER DEFAULT 90,
ADD COLUMN IF NOT EXISTS retention_audit_logs_days INTEGER DEFAULT 365;
