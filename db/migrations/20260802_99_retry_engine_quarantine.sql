-- Migration: Retry Engine and Quarantine System
-- Generalized retry and backoff management with quarantine for permanently failed items

-- Table for tracking retry attempts across any system
CREATE TABLE IF NOT EXISTS retry_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Work identification
  work_type VARCHAR(100) NOT NULL,  -- 'outbox_event', 'email', 'payment', 'webhook', etc.
  work_id VARCHAR(255) NOT NULL,     -- ID in original system (UUID or numeric)

  -- Retry tracking
  attempt_number INT NOT NULL,
  attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INT,

  -- Status
  status VARCHAR(50) NOT NULL,  -- 'pending', 'in_progress', 'success', 'failed_transient', 'failed_permanent'
  error_classification VARCHAR(50),  -- 'network', 'validation', 'internal', 'rate_limit', 'unknown'
  error_message TEXT,
  error_code VARCHAR(50),

  -- Backoff configuration
  backoff_strategy VARCHAR(50) NOT NULL DEFAULT 'exponential',  -- 'exponential', 'linear', 'fixed'
  backoff_multiplier DECIMAL(5, 2) DEFAULT 1.5,
  backoff_seconds INT,  -- Actual wait time before this attempt

  -- Context
  metadata JSONB,  -- Arbitrary metadata for debugging
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_status CHECK (status IN ('pending', 'in_progress', 'success', 'failed_transient', 'failed_permanent')),
  CONSTRAINT valid_classification CHECK (error_classification IN ('network', 'validation', 'internal', 'rate_limit', 'timeout', 'permanent', 'unknown')),
  CONSTRAINT valid_backoff CHECK (backoff_strategy IN ('exponential', 'linear', 'fixed'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_retry_attempts_work ON retry_attempts(work_type, work_id);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_status ON retry_attempts(status);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_classification ON retry_attempts(error_classification);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_attempt_at ON retry_attempts(attempt_at);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_pending ON retry_attempts(work_type, attempt_at)
  WHERE status = 'pending';

-- Quarantine table for permanently failed items
CREATE TABLE IF NOT EXISTS quarantine_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Work identification
  work_type VARCHAR(100) NOT NULL,
  work_id VARCHAR(255) NOT NULL,

  -- Why it's quarantined
  reason VARCHAR(255) NOT NULL,  -- 'max_retries_exceeded', 'permanent_error', 'manual_quarantine'
  permanent_error_code VARCHAR(50),
  permanent_error_message TEXT,

  -- Retry history
  total_attempts INT NOT NULL,
  first_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Original context
  payload JSONB NOT NULL,  -- Full payload for recovery
  tags VARCHAR(255)[] DEFAULT '{}',  -- For categorization

  -- Recovery tracking
  recovery_attempts INT DEFAULT 0,
  last_recovery_attempt_at TIMESTAMP WITH TIME ZONE,
  recovery_status VARCHAR(50),  -- 'waiting', 'in_progress', 'recovered', 'permanently_failed'

  -- Metadata
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT quarantine_work_type_id_not_empty CHECK (work_type != '' AND work_id != ''),
  CONSTRAINT valid_reason CHECK (reason IN ('max_retries_exceeded', 'permanent_error', 'manual_quarantine')),
  CONSTRAINT unique_quarantine UNIQUE (work_type, work_id)
);

-- Indexes for quarantine queue
-- (idx_quarantine_work retiré : redondant avec l'index de la contrainte UNIQUE ci-dessus)
CREATE INDEX IF NOT EXISTS idx_quarantine_reason ON quarantine_queue(reason);
CREATE INDEX IF NOT EXISTS idx_quarantine_recovery_status ON quarantine_queue(recovery_status);
CREATE INDEX IF NOT EXISTS idx_quarantine_created_at ON quarantine_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_quarantine_tags ON quarantine_queue USING GIN(tags);

-- Table for manual recovery operations
CREATE TABLE IF NOT EXISTS recovery_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linked to quarantine
  quarantine_id UUID NOT NULL REFERENCES quarantine_queue(id) ON DELETE CASCADE,
  work_type VARCHAR(100) NOT NULL,
  work_id VARCHAR(255) NOT NULL,

  -- Operation details
  operation_type VARCHAR(50) NOT NULL,  -- 'manual_retry', 'fix_and_retry', 'delete', 'skip'
  initiated_by VARCHAR(255) NOT NULL,  -- User email or system identifier
  initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Modifications
  payload_override JSONB,  -- Optional: modified payload for retry
  status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'in_progress', 'succeeded', 'failed'

  -- Results
  result_message TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT valid_operation CHECK (operation_type IN ('manual_retry', 'fix_and_retry', 'delete', 'skip')),
  CONSTRAINT valid_op_status CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed'))
);

-- Indexes for recovery operations
CREATE INDEX IF NOT EXISTS idx_recovery_quarantine ON recovery_operations(quarantine_id);
CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_operations(status);
CREATE INDEX IF NOT EXISTS idx_recovery_initiated_by ON recovery_operations(initiated_by);
CREATE INDEX IF NOT EXISTS idx_recovery_initiated_at ON recovery_operations(initiated_at);

-- Table for retry policy definitions (integrates with job_registry)
CREATE TABLE IF NOT EXISTS retry_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Policy identification
  policy_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,

  -- Backoff configuration
  backoff_strategy VARCHAR(50) NOT NULL,  -- 'exponential', 'linear', 'fixed'
  initial_backoff_seconds INT NOT NULL,  -- First retry wait time
  backoff_multiplier DECIMAL(5, 2) DEFAULT 1.5,  -- For exponential/linear
  max_backoff_seconds INT,  -- Cap on backoff time

  -- Retry limits
  max_attempts INT NOT NULL DEFAULT 3,
  max_total_duration_seconds INT,  -- Overall timeout for all retries

  -- Error handling
  retryable_error_codes VARCHAR(50)[] DEFAULT '{}',  -- Specific codes to retry on
  permanent_error_codes VARCHAR(50)[] DEFAULT '{}',  -- Codes that stop retries

  -- Quarantine
  quarantine_on_permanent_error BOOLEAN DEFAULT true,
  auto_quarantine_after_attempts INT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for retry policies
CREATE INDEX IF NOT EXISTS idx_retry_policies_name ON retry_policies(policy_name);

-- Predefined retry policies
INSERT INTO retry_policies (
  policy_name,
  description,
  backoff_strategy,
  initial_backoff_seconds,
  backoff_multiplier,
  max_backoff_seconds,
  max_attempts,
  max_total_duration_seconds,
  permanent_error_codes
) VALUES
  ('aggressive', 'Fast retries for critical operations', 'exponential', 10, 1.5, 300, 5, 900,
   '{"401", "403", "404", "422", "429"}'),

  ('moderate', 'Balanced retry strategy', 'exponential', 60, 2.0, 1800, 4, 3600,
   '{"401", "403", "404", "422"}'),

  ('conservative', 'Long wait times for stable systems', 'linear', 300, 1.0, 3600, 3, 7200,
   '{"401", "403", "404"}'),

  ('email_delivery', 'Extended retries for email delivery', 'exponential', 60, 2.0, 3600, 6, 14400,
   '{"401", "403", "404", "422"}'),

  ('webhook', 'Webhook delivery with reasonable timeouts', 'exponential', 30, 2.0, 900, 5, 1800,
   '{"401", "403", "404"}'),

  ('api_call', 'API integration with rate limit handling', 'exponential', 60, 1.5, 1800, 4, 3600,
   '{"401", "403", "404", "422"}')
ON CONFLICT DO NOTHING;

-- Update trigger for quarantine_queue updated_at
CREATE OR REPLACE FUNCTION update_quarantine_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quarantine_update_timestamp ON quarantine_queue;
CREATE TRIGGER quarantine_update_timestamp
BEFORE UPDATE ON quarantine_queue
FOR EACH ROW
EXECUTE FUNCTION update_quarantine_timestamp();

-- Update trigger for retry_policies updated_at
CREATE OR REPLACE FUNCTION update_retry_policies_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS retry_policies_update_timestamp ON retry_policies;
CREATE TRIGGER retry_policies_update_timestamp
BEFORE UPDATE ON retry_policies
FOR EACH ROW
EXECUTE FUNCTION update_retry_policies_timestamp();
