-- Migration: Create stripe retry logs table
-- Date: 2026-08-06
-- Purpose: Track Stripe payment retry attempts
-- FIXED: Changed UUID to INTEGER to match organisations.id type, added RLS

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_retry_logs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id BIGINT REFERENCES invoices(id) ON DELETE CASCADE,
  stripe_payment_intent_id VARCHAR(255),
  retry_count INTEGER DEFAULT 0,
  last_error_message TEXT,
  next_retry_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending', -- pending, success, failed, abandoned
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_org ON stripe_retry_logs(organisation_id);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_invoice ON stripe_retry_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_status ON stripe_retry_logs(status);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_next_retry ON stripe_retry_logs(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_stripe_retry_logs_org_status ON stripe_retry_logs(organisation_id, status);

-- RLS Policy
ALTER TABLE stripe_retry_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_retry_logs_org_isolation ON stripe_retry_logs
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Trigger for updated_at
CREATE TRIGGER stripe_retry_logs_updated_at
  BEFORE UPDATE ON stripe_retry_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;
