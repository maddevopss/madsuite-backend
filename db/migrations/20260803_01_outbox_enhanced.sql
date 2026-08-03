-- Migration: Enhanced Outbox with Retry Engine Integration
-- Integrates outbox_events with retry_attempts and quarantine_queue for reliable delivery

-- Add columns to outbox_events for retry engine integration
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS event_handler_name VARCHAR(100);
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS retry_policy_name VARCHAR(100) DEFAULT 'moderate';
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS delivery_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS quarantine_id UUID REFERENCES quarantine_queue(id) ON DELETE SET NULL;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS recovery_id UUID REFERENCES recovery_operations(id) ON DELETE SET NULL;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMP WITH TIME ZONE;

-- Create index for finding events linked to quarantine
CREATE INDEX IF NOT EXISTS idx_outbox_events_quarantine ON outbox_events(quarantine_id)
  WHERE quarantine_id IS NOT NULL;

-- Create index for recovery operations
CREATE INDEX IF NOT EXISTS idx_outbox_events_recovery ON outbox_events(recovery_id)
  WHERE recovery_id IS NOT NULL;

-- Create index for handler type
CREATE INDEX IF NOT EXISTS idx_outbox_events_handler ON outbox_events(event_handler_name, status);

-- Create table for event delivery statistics (by handler type)
CREATE TABLE IF NOT EXISTS outbox_delivery_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_handler_name VARCHAR(100) NOT NULL,
  date DATE NOT NULL,

  -- Counts
  total_events INT DEFAULT 0,
  successfully_delivered INT DEFAULT 0,
  failed_permanently INT DEFAULT 0,
  quarantined INT DEFAULT 0,
  recovered INT DEFAULT 0,

  -- Performance
  avg_delivery_time_ms DECIMAL,
  min_delivery_time_ms INT,
  max_delivery_time_ms INT,

  -- Errors
  most_common_error TEXT,
  error_count_by_type JSONB,  -- {"SMTP_TIMEOUT": 5, "AUTH_FAILED": 2, ...}

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_stats_date CHECK (event_handler_name != '' AND date IS NOT NULL),
  UNIQUE(event_handler_name, date)
);

-- Create index for daily stats lookup
CREATE INDEX IF NOT EXISTS idx_outbox_stats_date ON outbox_delivery_stats(date, event_handler_name);

-- Update trigger for outbox_delivery_stats updated_at
CREATE OR REPLACE FUNCTION update_outbox_stats_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_stats_update_timestamp ON outbox_delivery_stats;
CREATE TRIGGER outbox_stats_update_timestamp
BEFORE UPDATE ON outbox_delivery_stats
FOR EACH ROW
EXECUTE FUNCTION update_outbox_stats_timestamp();

-- Create table for event handler configuration
CREATE TABLE IF NOT EXISTS event_handlers (
  handler_name VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Delivery configuration
  timeout_seconds INT DEFAULT 30,
  max_attempts INT DEFAULT 3,
  retry_policy_name VARCHAR(100) NOT NULL DEFAULT 'moderate',

  -- Behavior
  idempotent BOOLEAN DEFAULT true,
  supports_batch BOOLEAN DEFAULT false,
  batch_size INT,

  -- Status
  enabled BOOLEAN DEFAULT true,
  notify_on_failure BOOLEAN DEFAULT true,

  -- Owner
  owner_team VARCHAR(100),
  owner_email VARCHAR(255),
  owner_slack_channel VARCHAR(255),

  -- Metadata
  tags VARCHAR(100)[],
  configuration JSONB,  -- Handler-specific config (endpoints, credentials, etc.)

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for handler lookups
CREATE INDEX IF NOT EXISTS idx_event_handlers_enabled ON event_handlers(enabled);

-- Update trigger for event_handlers
CREATE OR REPLACE FUNCTION update_event_handlers_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_handlers_update_timestamp ON event_handlers;
CREATE TRIGGER event_handlers_update_timestamp
BEFORE UPDATE ON event_handlers
FOR EACH ROW
EXECUTE FUNCTION update_event_handlers_timestamp();

-- Predefined event handlers
INSERT INTO event_handlers (
  handler_name,
  display_name,
  description,
  timeout_seconds,
  max_attempts,
  retry_policy_name,
  enabled,
  notify_on_failure,
  owner_team,
  owner_email,
  tags
) VALUES
  ('email_reminder', 'Email Reminder', 'Send reminder emails via SMTP', 30, 3, 'email_delivery', true, true, 'marketing', 'marketing@company.com', '{"email", "notifications"}'),
  ('webhook_delivery', 'Webhook Delivery', 'Deliver events to webhook endpoints', 15, 4, 'webhook', true, true, 'integrations', 'integrations@company.com', '{"webhook", "external"}'),
  ('sms_notification', 'SMS Notification', 'Send SMS notifications', 20, 2, 'aggressive', true, true, 'growth', 'growth@company.com', '{"sms", "notifications"}'),
  ('api_call', 'API Call', 'Make outbound API calls', 25, 3, 'api_call', true, true, 'platform', 'platform@company.com', '{"api", "external"}'),
  ('payment_processing', 'Payment Processing', 'Process payment transactions', 60, 2, 'conservative', true, true, 'billing', 'billing@company.com', '{"payment", "critical"}')
ON CONFLICT DO NOTHING;
