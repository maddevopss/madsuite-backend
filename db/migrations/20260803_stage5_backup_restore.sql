-- Migration: Stage 5 Backup & Restore
-- Comprehensive backup and point-in-time recovery for all Stage 5 components

-- Table for backup snapshots
CREATE TABLE IF NOT EXISTS backup_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type VARCHAR(50) NOT NULL,  -- 'full', 'incremental', 'schema_only', 'data_only'
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50) NOT NULL,       -- 'pending', 'in_progress', 'completed', 'failed', 'verified'

  -- Backup scope
  total_size_bytes BIGINT,
  components_backed_up INT,
  tables_backed_up INT,
  total_rows_backed_up BIGINT,

  -- Metadata
  metadata JSONB,                     -- {component_counts, retention_days, verification_hash, source_snapshot_id}
  initiator_user_id VARCHAR(255),     -- Who initiated the backup
  initiator_reason TEXT,              -- Why backup was triggered (scheduled, manual, recovery, etc.)

  -- Verification
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by VARCHAR(255),
  verification_details JSONB,         -- {checks_passed, checks_failed, issues}

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for snapshot queries
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_status ON backup_snapshots(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_type ON backup_snapshots(backup_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_verified ON backup_snapshots(verified, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created ON backup_snapshots(created_at DESC);

-- Table for component backup details
CREATE TABLE IF NOT EXISTS backup_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES backup_snapshots(id) ON DELETE CASCADE,
  component_name VARCHAR(100) NOT NULL,  -- 'schema_inventory', 'job_registry', 'retry_engine', etc.

  -- Backup statistics
  table_count INT,
  row_count BIGINT,
  size_bytes BIGINT,

  -- Data integrity
  checksum_hash VARCHAR(64),          -- SHA256 hash for integrity verification
  status VARCHAR(50) NOT NULL,        -- 'pending', 'in_progress', 'completed', 'failed'
  error_message TEXT,

  -- Timing
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(snapshot_id, component_name)
);

-- Create indexes for component queries
CREATE INDEX IF NOT EXISTS idx_backup_components_snapshot ON backup_components(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_backup_components_component ON backup_components(component_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_components_status ON backup_components(status);

-- Table for backup verification results
CREATE TABLE IF NOT EXISTS backup_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES backup_snapshots(id) ON DELETE CASCADE,
  verification_type VARCHAR(100) NOT NULL,  -- 'schema_integrity', 'foreign_keys', 'row_counts', 'checksums', 'timestamps'

  -- Verification results
  status VARCHAR(50) NOT NULL,        -- 'passed', 'failed', 'warning'
  passed_checks INT DEFAULT 0,
  failed_checks INT DEFAULT 0,
  warning_checks INT DEFAULT 0,

  -- Details
  details JSONB,                      -- {failed_tables, issues, recommendations}
  error_message TEXT,

  -- Metadata
  verified_by VARCHAR(255),           -- System or user who ran verification
  verified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(snapshot_id, verification_type)
);

-- Create indexes for verification queries
CREATE INDEX IF NOT EXISTS idx_backup_verifications_snapshot ON backup_verifications(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_backup_verifications_type ON backup_verifications(verification_type);
CREATE INDEX IF NOT EXISTS idx_backup_verifications_status ON backup_verifications(status);

-- Table for restore operations
CREATE TABLE IF NOT EXISTS restore_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_snapshot_id UUID NOT NULL REFERENCES backup_snapshots(id) ON DELETE CASCADE,
  target_environment VARCHAR(50) NOT NULL,  -- 'staging', 'production', 'dev', 'recovery'

  -- Operation tracking
  status VARCHAR(50) NOT NULL,        -- 'pending', 'in_progress', 'completed', 'failed', 'rolled_back'
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  duration_ms INT,

  -- Restore scope
  restore_scope VARCHAR(100),         -- 'full', 'components', 'point_in_time'
  components_restored INT,
  tables_restored INT,
  total_rows_restored BIGINT,

  -- Verification after restore
  verified_after_restore BOOLEAN DEFAULT false,
  verification_status VARCHAR(50),    -- 'passed', 'failed', 'partial'

  -- Error handling
  errors JSONB,                       -- [{component, error_message, severity}]
  error_count INT DEFAULT 0,

  -- Metadata
  initiated_by VARCHAR(255) NOT NULL,
  initiator_reason TEXT,
  pre_restore_snapshot_id UUID,       -- Backup of current state before restore (safety)
  rollback_performed BOOLEAN DEFAULT false,
  rollback_time TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for restore queries
CREATE INDEX IF NOT EXISTS idx_restore_operations_snapshot ON restore_operations(source_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_restore_operations_status ON restore_operations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restore_operations_environment ON restore_operations(target_environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restore_operations_created ON restore_operations(created_at DESC);

-- Table for backup retention policy
CREATE TABLE IF NOT EXISTS backup_retention_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type VARCHAR(50) NOT NULL,           -- 'full', 'incremental', 'schema_only'
  retention_days INT NOT NULL DEFAULT 30,
  min_backups_to_keep INT DEFAULT 3,
  size_quota_gb INT,
  auto_purge BOOLEAN DEFAULT true,

  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(backup_type)
);

-- Create indexes for policy queries
CREATE INDEX IF NOT EXISTS idx_backup_retention_type ON backup_retention_policy(backup_type);

-- Update triggers
CREATE OR REPLACE FUNCTION update_backup_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS backup_snapshots_update ON backup_snapshots;
CREATE TRIGGER backup_snapshots_update BEFORE UPDATE ON backup_snapshots
FOR EACH ROW EXECUTE FUNCTION update_backup_timestamp();

DROP TRIGGER IF EXISTS backup_components_update ON backup_components;
CREATE TRIGGER backup_components_update BEFORE UPDATE ON backup_components
FOR EACH ROW EXECUTE FUNCTION update_backup_timestamp();

DROP TRIGGER IF EXISTS restore_operations_update ON restore_operations;
CREATE TRIGGER restore_operations_update BEFORE UPDATE ON restore_operations
FOR EACH ROW EXECUTE FUNCTION update_backup_timestamp();

DROP TRIGGER IF EXISTS backup_retention_policy_update ON backup_retention_policy;
CREATE TRIGGER backup_retention_policy_update BEFORE UPDATE ON backup_retention_policy
FOR EACH ROW EXECUTE FUNCTION update_backup_timestamp();

-- Predefined retention policies
INSERT INTO backup_retention_policy (backup_type, retention_days, min_backups_to_keep, size_quota_gb, auto_purge, description)
VALUES
  ('full', 30, 7, 50, true, 'Full backups: keep 7 daily + retain for 30 days'),
  ('incremental', 7, 24, 10, true, 'Incremental backups: keep 24 hourly + 7 days'),
  ('schema_only', 365, 1, 5, false, 'Schema backups: keep indefinitely (audit trail)'),
  ('data_only', 7, 3, 20, true, 'Data-only backups: keep 3 recent, 7 days')
ON CONFLICT (backup_type) DO NOTHING;

-- Views for backup monitoring

-- Current backup status summary
CREATE OR REPLACE VIEW observability.backup_status_summary AS
SELECT
  bs.id as snapshot_id,
  bs.backup_type,
  bs.status,
  bs.total_size_bytes,
  bs.components_backed_up,
  bs.verified,
  bs.verified_at as last_verification_at,
  bs.created_at,
  EXTRACT(EPOCH FROM (bs.end_time - bs.start_time))::INT as duration_seconds,
  COUNT(DISTINCT bc.component_name) as components_in_snapshot,
  SUM(CASE WHEN bv.status = 'passed' THEN 1 ELSE 0 END) as verifications_passed,
  SUM(CASE WHEN bv.status = 'failed' THEN 1 ELSE 0 END) as verifications_failed
FROM backup_snapshots bs
LEFT JOIN backup_components bc ON bc.snapshot_id = bs.id
LEFT JOIN backup_verifications bv ON bv.snapshot_id = bs.id
WHERE bs.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY bs.id, bs.backup_type, bs.status, bs.total_size_bytes, bs.components_backed_up,
         bs.verified, bs.verified_at, bs.created_at, bs.end_time, bs.start_time;

-- Backup timeline (aggregated by day)
CREATE OR REPLACE VIEW observability.backup_timeline AS
SELECT
  DATE(bs.created_at) as backup_date,
  bs.backup_type,
  COUNT(*) as snapshot_count,
  SUM(bs.total_size_bytes) as total_size_bytes,
  COUNT(*) FILTER (WHERE bs.status = 'completed') as successful_backups,
  COUNT(*) FILTER (WHERE bs.status = 'failed') as failed_backups,
  AVG(EXTRACT(EPOCH FROM (bs.end_time - bs.start_time)))::INT as avg_duration_seconds,
  COUNT(*) FILTER (WHERE bs.verified = true) as verified_count
FROM backup_snapshots bs
WHERE bs.created_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'
GROUP BY DATE(bs.created_at), bs.backup_type
ORDER BY backup_date DESC;

-- Recent restore operations
CREATE OR REPLACE VIEW observability.recent_restore_operations AS
SELECT
  ro.id,
  ro.source_snapshot_id,
  ro.target_environment,
  ro.status,
  ro.total_rows_restored,
  ro.verified_after_restore,
  ro.initiated_by,
  ro.created_at,
  EXTRACT(EPOCH FROM (ro.end_time - ro.start_time))::INT as duration_seconds,
  COALESCE(ro.error_count, 0) as error_count
FROM restore_operations ro
WHERE ro.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
ORDER BY ro.created_at DESC;

-- Backup verification summary
CREATE OR REPLACE VIEW observability.backup_verification_summary AS
SELECT
  bs.id as snapshot_id,
  bs.backup_type,
  bs.created_at,
  COUNT(*) as total_verifications,
  COUNT(*) FILTER (WHERE bv.status = 'passed') as passed_verifications,
  COUNT(*) FILTER (WHERE bv.status = 'failed') as failed_verifications,
  COUNT(*) FILTER (WHERE bv.status = 'warning') as warning_verifications,
  MAX(bv.verified_at) as last_verification_at
FROM backup_snapshots bs
LEFT JOIN backup_verifications bv ON bv.snapshot_id = bs.id
WHERE bs.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY bs.id, bs.backup_type, bs.created_at
ORDER BY bs.created_at DESC;

-- Comments
COMMENT ON TABLE backup_snapshots IS 'Records of all backup operations with metadata and verification status';
COMMENT ON TABLE backup_components IS 'Per-component backup details including size, row count, and checksums';
COMMENT ON TABLE backup_verifications IS 'Backup integrity verification results (schema, FK, row counts, checksums)';
COMMENT ON TABLE restore_operations IS 'Log of all restore operations with outcome and error tracking';
COMMENT ON TABLE backup_retention_policy IS 'Configurable retention policies for automatic backup cleanup';
