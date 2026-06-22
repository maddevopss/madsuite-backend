-- Migration: Add idempotency_key to activity_logs
-- This prevents double-billing if the desktop agent replays captured events.

ALTER TABLE activity_logs
ADD COLUMN idempotency_key VARCHAR(64);

CREATE UNIQUE INDEX idx_activity_logs_idempotency_key 
ON activity_logs (idempotency_key) 
WHERE idempotency_key IS NOT NULL;
