-- Migration: Stage 6 Sensitive Transition Security
-- Prevention of self-approval, elevation, replay, and field bypass attacks

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT 'Default organization',
  slug VARCHAR(255) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255) UNIQUE;

CREATE TABLE IF NOT EXISTS role_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  role_type VARCHAR(50) DEFAULT 'organization',
  organization_id VARCHAR(255) REFERENCES organizations(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES role_definitions(id) ON DELETE RESTRICT,
  scope VARCHAR(50) DEFAULT 'organization',
  scope_id VARCHAR(255),
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by VARCHAR(255),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, organization_id, role_id, scope, scope_id)
);

-- Table for sensitive operation definitions
CREATE TABLE IF NOT EXISTS sensitive_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Operation identification
  operation_name VARCHAR(255) NOT NULL UNIQUE,
  operation_type VARCHAR(100),                -- 'payroll_change', 'access_grant', 'config_update', 'deletion', 'approval'
  description TEXT,

  -- Security requirements
  requires_separate_approver BOOLEAN DEFAULT true,  -- Cannot self-approve
  requires_two_factor_auth BOOLEAN DEFAULT false,   -- Requires 2FA for execution
  requires_executive_approval BOOLEAN DEFAULT false, -- High-level approval needed
  requires_audit_log BOOLEAN DEFAULT true,          -- Must be logged with details

  -- Replay prevention
  requires_idempotency_key BOOLEAN DEFAULT true,   -- Prevent duplicate submissions
  idempotency_window_seconds INT DEFAULT 3600,    -- Window to check duplicates

  -- Rate limiting
  max_per_hour INT,
  max_per_day INT,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensitive_ops_active ON sensitive_operations(is_active);
CREATE INDEX IF NOT EXISTS idx_sensitive_ops_type ON sensitive_operations(operation_type);
CREATE INDEX IF NOT EXISTS idx_sensitive_ops_requires_approval ON sensitive_operations(requires_separate_approver);

-- Table for restricted fields (cannot be changed by customer)
CREATE TABLE IF NOT EXISTS restricted_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Field identification
  table_name VARCHAR(100) NOT NULL,
  column_name VARCHAR(100) NOT NULL,
  field_display_name VARCHAR(255),

  -- Restriction type
  restriction_type VARCHAR(100),           -- 'read_only', 'system_only', 'admin_only', 'no_customer_update'
  reason TEXT,

  -- Who can modify
  allowed_roles JSONB,                     -- Roles that CAN modify despite restriction

  -- Audit
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(table_name, column_name)
);

CREATE INDEX IF NOT EXISTS idx_restricted_fields_active ON restricted_fields(is_active, table_name);
CREATE INDEX IF NOT EXISTS idx_restricted_fields_table ON restricted_fields(table_name);

-- Table for operation approvals
CREATE TABLE IF NOT EXISTS operation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Operation details
  operation_id VARCHAR(255) NOT NULL UNIQUE,
  operation_type VARCHAR(100) NOT NULL,
  sensitive_operation_id UUID REFERENCES sensitive_operations(id),

  -- Approver information
  requester_user_id VARCHAR(255) NOT NULL,
  requester_org_id VARCHAR(255) NOT NULL,
  approver_user_id VARCHAR(255),

  -- Approval status
  status VARCHAR(50) NOT NULL,              -- 'pending', 'approved', 'rejected', 'cancelled'
  status_changed_at TIMESTAMP WITH TIME ZONE,

  -- Security checks
  self_approval_detected BOOLEAN DEFAULT false,
  authority_elevation_detected BOOLEAN DEFAULT false,
  field_bypass_detected BOOLEAN DEFAULT false,
  replay_attempt_detected BOOLEAN DEFAULT false,

  -- Approval details
  approval_reason TEXT,
  rejection_reason TEXT,
  approval_method VARCHAR(50),              -- 'manual', 'automatic', '2fa', 'executive'

  -- Metadata
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE,     -- Approval window expires

  -- Audit
  requested_details JSONB,
  approved_changes JSONB,

  CONSTRAINT fk_approval_org FOREIGN KEY (requester_org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON operation_approvals(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_requester ON operation_approvals(requester_user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON operation_approvals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approvals_security ON operation_approvals(
  self_approval_detected,
  authority_elevation_detected,
  field_bypass_detected,
  replay_attempt_detected
);

-- Table for replay attack prevention (idempotency)
CREATE TABLE IF NOT EXISTS operation_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotency tracking
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  operation_type VARCHAR(100) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,

  -- First submission
  first_submission_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_submission_details JSONB,
  first_result JSONB,

  -- Replay attempts
  replay_attempt_count INT DEFAULT 0,
  last_replay_attempt_at TIMESTAMP WITH TIME ZONE,
  last_replay_details JSONB,

  -- Window management
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_expired BOOLEAN DEFAULT false,

  CONSTRAINT fk_idempotency_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_idempotency_key ON operation_idempotency_keys(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_user ON operation_idempotency_keys(user_id, operation_type, first_submission_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_expired ON operation_idempotency_keys(is_expired);

-- Table for sensitive operation audit trail
CREATE TABLE IF NOT EXISTS sensitive_operation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Operation context
  operation_id VARCHAR(255) NOT NULL,
  operation_type VARCHAR(100) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,

  -- Changes tracked
  table_affected VARCHAR(100),
  record_id VARCHAR(255),
  changes_json JSONB,
  restricted_fields_modified JSONB,  -- Which restricted fields were touched

  -- Security events
  requires_approval BOOLEAN DEFAULT false,
  approval_obtained BOOLEAN DEFAULT false,
  approver_id VARCHAR(255),
  self_approval_risk BOOLEAN DEFAULT false,
  elevation_risk BOOLEAN DEFAULT false,

  -- Replay tracking
  idempotency_key VARCHAR(255),
  is_replay BOOLEAN DEFAULT false,

  -- Execution
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50),                -- 'success', 'rejected', 'blocked'
  blocking_reason TEXT,

  CONSTRAINT fk_audit_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_operation ON sensitive_operation_audit(operation_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON sensitive_operation_audit(user_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org ON sensitive_operation_audit(organization_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_replay ON sensitive_operation_audit(is_replay);
CREATE INDEX IF NOT EXISTS idx_audit_risk ON sensitive_operation_audit(self_approval_risk, elevation_risk);

-- Table for authority elevation attempts
CREATE TABLE IF NOT EXISTS elevation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Attempt details
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  "current_role" VARCHAR(100),
  target_role VARCHAR(100),

  -- Detection
  elevation_type VARCHAR(100),             -- 'self_promotion', 'privilege_escalation', 'permission_grant'
  detected_in_operation VARCHAR(255),

  -- Response
  blocked BOOLEAN DEFAULT true,
  alert_sent BOOLEAN DEFAULT false,

  -- Timestamp
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_elevation_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_elevation_user ON elevation_attempts(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_elevation_org ON elevation_attempts(organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_elevation_blocked ON elevation_attempts(blocked);

-- View for pending approvals
CREATE OR REPLACE VIEW pending_approvals_summary AS
SELECT
  COUNT(*) as pending_count,
  COUNT(CASE WHEN expires_at < CURRENT_TIMESTAMP THEN 1 END) as expired_count,
  COUNT(CASE WHEN self_approval_detected = true THEN 1 END) as self_approval_risks,
  COUNT(CASE WHEN authority_elevation_detected = true THEN 1 END) as elevation_risks,
  COUNT(CASE WHEN field_bypass_detected = true THEN 1 END) as field_bypass_risks
FROM operation_approvals
WHERE status = 'pending';

-- View for sensitive operation audit trail
CREATE OR REPLACE VIEW sensitive_operations_audit_summary AS
SELECT
  operation_type,
  COUNT(*) as total_operations,
  COUNT(CASE WHEN requires_approval = true THEN 1 END) as required_approvals,
  COUNT(CASE WHEN approval_obtained = true THEN 1 END) as approved_operations,
  COUNT(CASE WHEN self_approval_risk = true THEN 1 END) as self_approval_risks,
  COUNT(CASE WHEN elevation_risk = true THEN 1 END) as elevation_risks,
  COUNT(CASE WHEN is_replay = true THEN 1 END) as replay_attempts,
  MAX(executed_at) as latest_operation
FROM sensitive_operation_audit
WHERE executed_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY operation_type;

-- View for replay attack attempts
CREATE OR REPLACE VIEW replay_attack_summary AS
SELECT
  operation_type,
  user_id,
  COUNT(*) as total_attempts,
  COUNT(CASE WHEN replay_attempt_count > 0 THEN 1 END) as with_replays,
  MAX(last_replay_attempt_at) as most_recent_replay
FROM operation_idempotency_keys
WHERE last_replay_attempt_at IS NOT NULL
GROUP BY operation_type, user_id;

-- Update trigger for sensitive operations
CREATE OR REPLACE FUNCTION update_sensitive_ops_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sensitive_ops_update ON sensitive_operations;
CREATE TRIGGER sensitive_ops_update BEFORE UPDATE ON sensitive_operations
FOR EACH ROW EXECUTE FUNCTION update_sensitive_ops_timestamp();

-- Comments
COMMENT ON TABLE sensitive_operations IS 'Define sensitive operations that require approval, replay prevention, and security checks';
COMMENT ON TABLE restricted_fields IS 'Define fields that cannot be modified by customers or certain roles';
COMMENT ON TABLE operation_approvals IS 'Track approval status and security risk detection for sensitive operations';
COMMENT ON TABLE operation_idempotency_keys IS 'Prevent replay attacks by tracking operation idempotency keys';
COMMENT ON TABLE sensitive_operation_audit IS 'Complete audit trail of all sensitive operations with security events';
COMMENT ON TABLE elevation_attempts IS 'Track and block authority elevation and privilege escalation attempts';