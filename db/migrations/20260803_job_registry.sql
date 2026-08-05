-- Migration: Job Registry for Scheduled Tasks
-- Centralizes definition of all periodic jobs with owner, timeout, and SLA metadata

CREATE TABLE IF NOT EXISTS job_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Ownership & Responsibility
  owner_team VARCHAR(100),
  owner_contact_email VARCHAR(255),
  owner_slack_channel VARCHAR(255),

  -- Scheduling
  cron_expression VARCHAR(255) NOT NULL,  -- e.g., "0 * * * *" (hourly)
  frequency_hours DECIMAL(10, 2) NOT NULL,  -- Expected frequency in hours for monitoring

  -- Execution Constraints
  timeout_seconds INT NOT NULL DEFAULT 300,  -- Max execution time
  max_delay_seconds INT NOT NULL DEFAULT 3600,  -- SLA: must complete within X seconds of schedule

  -- Locking Strategy
  lock_type VARCHAR(50) NOT NULL DEFAULT 'advisory',  -- 'advisory', 'table', 'none'
  lock_ttl_seconds INT DEFAULT 600,  -- Time before lock is considered stale

  -- Configuration
  criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',  -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify_on_failure BOOLEAN NOT NULL DEFAULT true,
  notify_on_timeout BOOLEAN NOT NULL DEFAULT true,

  -- Tracking
  last_started_at TIMESTAMP WITH TIME ZONE,
  last_completed_at TIMESTAMP WITH TIME ZONE,
  last_status VARCHAR(50),  -- 'SUCCESS', 'FAILED', 'TIMEOUT', 'STARTED'
  last_error_message TEXT,
  consecutive_failures INT DEFAULT 0,

  -- Metadata
  tags VARCHAR(255)[] DEFAULT '{}',  -- e.g., 'billing', 'analytics', 'cleanup'
  retry_policy JSONB,  -- {"strategy": "exponential", "max_attempts": 3, "backoff_seconds": 60}
  performance_metrics JSONB,  -- {"avg_duration_ms": 1500, "p95_duration_ms": 3000}

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_criticality CHECK (criticality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT valid_lock_type CHECK (lock_type IN ('advisory', 'table', 'none')),
  CONSTRAINT valid_timeout CHECK (timeout_seconds > 0),
  CONSTRAINT valid_max_delay CHECK (max_delay_seconds > 0)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_job_registry_enabled ON job_registry(enabled);
CREATE INDEX IF NOT EXISTS idx_job_registry_criticality ON job_registry(criticality);
CREATE INDEX IF NOT EXISTS idx_job_registry_owner_team ON job_registry(owner_team);
CREATE INDEX IF NOT EXISTS idx_job_registry_last_started_at ON job_registry(last_started_at);
CREATE INDEX IF NOT EXISTS idx_job_registry_last_status ON job_registry(last_status);
CREATE INDEX IF NOT EXISTS idx_job_registry_tags ON job_registry USING GIN(tags);

-- Table for tracking job lock acquisitions and releases
CREATE TABLE IF NOT EXISTS job_lock_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name VARCHAR(100) NOT NULL,
  instance_hostname VARCHAR(255) NOT NULL,
  acquired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INT,
  status VARCHAR(50) NOT NULL DEFAULT 'HELD',  -- 'HELD', 'RELEASED', 'TIMED_OUT', 'DEADLOCKED'

  FOREIGN KEY (job_name) REFERENCES job_registry(job_name) ON DELETE CASCADE,
  CONSTRAINT valid_lock_status CHECK (status IN ('HELD', 'RELEASED', 'TIMED_OUT', 'DEADLOCKED'))
);

-- Indexes for lock tracking
CREATE INDEX IF NOT EXISTS idx_job_lock_tracking_job_name ON job_lock_tracking(job_name);
CREATE INDEX IF NOT EXISTS idx_job_lock_tracking_status ON job_lock_tracking(status);
CREATE INDEX IF NOT EXISTS idx_job_lock_tracking_acquired_at ON job_lock_tracking(acquired_at);
CREATE INDEX IF NOT EXISTS idx_job_lock_tracking_instance ON job_lock_tracking(instance_hostname);

-- Table for job SLA and performance tracking
CREATE TABLE IF NOT EXISTS job_sla_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name VARCHAR(100) NOT NULL,
  execution_date DATE NOT NULL,

  -- Execution counts
  total_executions INT DEFAULT 0,
  successful_executions INT DEFAULT 0,
  failed_executions INT DEFAULT 0,
  timeout_executions INT DEFAULT 0,

  -- Performance
  avg_duration_ms DECIMAL(10, 2),
  min_duration_ms INT,
  max_duration_ms INT,
  p95_duration_ms INT,
  p99_duration_ms INT,

  -- SLA
  sla_met BOOLEAN,
  sla_breaches INT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_name) REFERENCES job_registry(job_name) ON DELETE CASCADE,
  UNIQUE(job_name, execution_date)
);

-- Indexes for SLA metrics
CREATE INDEX IF NOT EXISTS idx_job_sla_metrics_job_name ON job_sla_metrics(job_name);
CREATE INDEX IF NOT EXISTS idx_job_sla_metrics_date ON job_sla_metrics(execution_date);
CREATE INDEX IF NOT EXISTS idx_job_sla_metrics_sla_met ON job_sla_metrics(sla_met);

-- Update trigger for job_registry updated_at
CREATE OR REPLACE FUNCTION update_job_registry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS job_registry_update_timestamp ON job_registry;
CREATE TRIGGER job_registry_update_timestamp
BEFORE UPDATE ON job_registry
FOR EACH ROW
EXECUTE FUNCTION update_job_registry_timestamp();
