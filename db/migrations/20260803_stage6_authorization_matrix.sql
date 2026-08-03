-- Migration: Stage 6 Authorization Matrix
-- Complete authorization framework with RBAC and route-level permissions

-- Table for organizations (required by foreign keys below)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table for role definitions
CREATE TABLE IF NOT EXISTS role_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Role identification
  role_name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Role classification
  role_type VARCHAR(50) NOT NULL,           -- 'system', 'organization', 'department', 'custom'
  organization_id UUID,                     -- NULL for system roles
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),

  CONSTRAINT fk_role_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

-- Create indexes for role queries
CREATE INDEX IF NOT EXISTS idx_roles_active ON role_definitions(is_active, organization_id);
CREATE INDEX IF NOT EXISTS idx_roles_name ON role_definitions(role_name);
CREATE INDEX IF NOT EXISTS idx_roles_organization ON role_definitions(organization_id);

-- Table for permission definitions
CREATE TABLE IF NOT EXISTS permission_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Permission identification
  permission_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  category VARCHAR(50),                     -- 'read', 'create', 'update', 'delete', 'approve', 'admin'

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for permission queries
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permission_definitions(permission_name);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permission_definitions(category);

-- Table for role-permission mapping
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  role_id UUID NOT NULL REFERENCES role_definitions(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permission_definitions(id) ON DELETE CASCADE,

  -- Conditional permission (e.g., "only own resources")
  condition_type VARCHAR(100),              -- 'all_resources', 'own_resources', 'department_resources', 'custom'
  condition_metadata JSONB,                 -- Additional conditions

  -- Audit
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  granted_by VARCHAR(255),

  UNIQUE(role_id, permission_id),
  CONSTRAINT fk_role_perm_role FOREIGN KEY (role_id) REFERENCES role_definitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_perm_perm FOREIGN KEY (permission_id) REFERENCES permission_definitions(id) ON DELETE CASCADE
);

-- Create indexes for role-permission queries
CREATE INDEX IF NOT EXISTS idx_role_perms_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_condition ON role_permissions(condition_type);

-- Table for route-permission mapping
CREATE TABLE IF NOT EXISTS route_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Route identification
  http_method VARCHAR(10) NOT NULL,         -- GET, POST, PUT, DELETE, PATCH
  route_path VARCHAR(500) NOT NULL,        -- /api/users, /api/payroll/:id
  route_name VARCHAR(255),                 -- semantic name
  description TEXT,

  -- Required permissions (can require multiple)
  required_permission_id UUID NOT NULL REFERENCES permission_definitions(id) ON DELETE RESTRICT,

  -- Sensitive route flagging
  is_sensitive BOOLEAN DEFAULT false,       -- Requires replay protection
  requires_approval BOOLEAN DEFAULT false,  -- Needs explicit approval

  -- Rate limiting
  rate_limit_per_hour INT,                 -- Per user per hour

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(http_method, route_path)
);

-- Create indexes for route queries
CREATE INDEX IF NOT EXISTS idx_routes_active ON route_permissions(is_active);
CREATE INDEX IF NOT EXISTS idx_routes_permission ON route_permissions(required_permission_id);
CREATE INDEX IF NOT EXISTS idx_routes_sensitive ON route_permissions(is_sensitive);
CREATE INDEX IF NOT EXISTS idx_routes_path ON route_permissions(route_path);

-- Table for user-role assignment (per organization)
CREATE TABLE IF NOT EXISTS user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) NOT NULL,
  organization_id UUID NOT NULL,
  role_id UUID NOT NULL,

  -- Assignment scope
  scope VARCHAR(50) DEFAULT 'organization',  -- 'organization', 'department', 'team', 'resource'
  scope_id UUID,                             -- Department/team/resource ID if scoped

  -- Lifecycle
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by VARCHAR(255) NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by VARCHAR(255),

  -- Audit
  is_active BOOLEAN DEFAULT true,

  CONSTRAINT fk_user_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES role_definitions(id) ON DELETE RESTRICT,
  UNIQUE(user_id, organization_id, role_id, scope, scope_id)
);

-- Create indexes for user-role queries
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_role_assignments(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_role_assignments(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON user_role_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_role_assignments(is_active);

-- Table for authorization audit trail
CREATE TABLE IF NOT EXISTS authorization_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) NOT NULL,
  organization_id UUID,

  -- Action details
  action_type VARCHAR(100) NOT NULL,        -- 'permission_check', 'permission_denied', 'role_assigned', 'role_revoked'
  route_path VARCHAR(500),
  http_method VARCHAR(10),

  -- Decision
  decision VARCHAR(50) NOT NULL,            -- 'allowed', 'denied'
  denial_reason VARCHAR(255),               -- Why denied

  -- Context
  ip_address VARCHAR(100),
  user_agent TEXT,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON authorization_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_org ON authorization_audit(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_decision ON authorization_audit(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_route ON authorization_audit(route_path, created_at DESC);

-- Table for permission escalation detection
CREATE TABLE IF NOT EXISTS permission_escalation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) NOT NULL,
  organization_id UUID,

  -- Escalation details
  attempted_permission VARCHAR(100) NOT NULL,
  current_permission VARCHAR(100),

  -- Detection
  detection_type VARCHAR(100),              -- 'self_approval', 'role_elevation', 'field_bypass', 'replay_attempt'

  -- Response
  blocked BOOLEAN DEFAULT true,
  alert_sent BOOLEAN DEFAULT false,

  -- Timestamp
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for escalation queries
CREATE INDEX IF NOT EXISTS idx_escalation_user ON permission_escalation_attempts(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalation_type ON permission_escalation_attempts(detection_type);
CREATE INDEX IF NOT EXISTS idx_escalation_org ON permission_escalation_attempts(organization_id);

-- View for user effective permissions
CREATE OR REPLACE VIEW user_effective_permissions AS
SELECT
  ura.user_id,
  ura.organization_id,
  rd.role_name,
  pd.permission_name,
  pd.category,
  rp.condition_type,
  rp.condition_metadata,
  ura.is_active,
  ura.assigned_at,
  ura.revoked_at
FROM user_role_assignments ura
JOIN role_definitions rd ON rd.id = ura.role_id
JOIN role_permissions rp ON rp.role_id = rd.id
JOIN permission_definitions pd ON pd.id = rp.permission_id
WHERE ura.is_active = true AND rd.is_active = true
ORDER BY ura.user_id, ura.organization_id, rd.role_name;

-- View for route coverage
CREATE OR REPLACE VIEW route_coverage_status AS
SELECT
  http_method,
  route_path,
  route_name,
  CASE WHEN required_permission_id IS NOT NULL THEN 'covered' ELSE 'uncovered' END as coverage_status,
  is_sensitive,
  requires_approval,
  rate_limit_per_hour,
  is_active
FROM route_permissions
ORDER BY route_path, http_method;

-- View for authorization decisions
CREATE OR REPLACE VIEW recent_authorization_decisions AS
SELECT
  aa.user_id,
  aa.organization_id,
  aa.action_type,
  aa.route_path,
  aa.http_method,
  aa.decision,
  aa.denial_reason,
  aa.created_at,
  COUNT(*) OVER (PARTITION BY aa.user_id, aa.decision ORDER BY aa.created_at DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as decision_sequence
FROM authorization_audit aa
WHERE aa.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
ORDER BY aa.created_at DESC;

-- Update triggers for timestamps
CREATE OR REPLACE FUNCTION update_authorization_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_def_update ON role_definitions;
CREATE TRIGGER role_def_update BEFORE UPDATE ON role_definitions
FOR EACH ROW EXECUTE FUNCTION update_authorization_timestamp();

DROP TRIGGER IF EXISTS route_perms_update ON route_permissions;
CREATE TRIGGER route_perms_update BEFORE UPDATE ON route_permissions
FOR EACH ROW EXECUTE FUNCTION update_authorization_timestamp();

-- Comments
COMMENT ON TABLE role_definitions IS 'Define roles (system, organization, department, custom) with lifecycle tracking';
COMMENT ON TABLE permission_definitions IS 'Define permissions (read, create, update, delete, approve, admin)';
COMMENT ON TABLE role_permissions IS 'Map roles to permissions with optional conditions (all/own/department resources)';
COMMENT ON TABLE route_permissions IS 'Map API routes to required permissions with sensitivity and rate-limit flags';
COMMENT ON TABLE user_role_assignments IS 'Assign users to roles per organization with lifecycle tracking';
COMMENT ON TABLE authorization_audit IS 'Audit trail of all authorization decisions (allowed/denied)';
COMMENT ON TABLE permission_escalation_attempts IS 'Detect and block permission escalation attempts (self-approval, role elevation, etc)';
