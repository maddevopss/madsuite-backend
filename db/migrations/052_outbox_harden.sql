-- Migration 052: Outbox Hardening (Idempotency, Retry, DLQ)
-- Adds exponential backoff capabilities and better error tracking

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_outbox_events_retry ON outbox_events(status, next_retry_at) WHERE status = 'pending';
