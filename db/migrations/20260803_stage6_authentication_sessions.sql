-- Migration: Stage 6 Authentication & Sessions
-- Session management, authentication methods, device tracking, and 2FA configuration

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT 'Default organization',
  slug VARCHAR(255) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table for session definitions and configuration
CREATE TABLE IF NOT EXISTS session_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Configuration identification
  organization_id VARCHAR(255) NOT NULL,
  session_type VARCHAR(100),                     -- 'web', 'mobile', 'api', 'admin', 'service_account'
  session_name VARCHAR(255) NOT NULL,

  -- Session lifetime
  session_timeout_minutes INT DEFAULT 30,        -- Inactivity timeout
  session_max_duration_minutes INT DEFAULT 480,  -- Absolute max session duration (8 hours)
  session_renewal_window_minutes INT DEFAULT 5,  -- Renew if within N minutes of expiry

  -- Security requirements
  require_twofa BOOLEAN DEFAULT false,            -- Require 2FA for this session type
  require_device_fingerprint BOOLEAN DEFAULT false,
  require_geolocation_match BOOLEAN DEFAULT false,
  require_ip_whitelist BOOLEAN DEFAULT false,
  concurrent_session_limit INT,                  -- Max sessions per user (null = unlimited)

  -- Device management
  allow_remembered_devices BOOLEAN DEFAULT true,
  max_remembered_devices_per_user INT DEFAULT 5,
  require_device_approval BOOLEAN DEFAULT false, -- First login on device requires approval

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(organization_id, session_type),
  CONSTRAINT fk_session_config_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_config_active ON session_configurations(is_active);
CREATE INDEX IF NOT EXISTS idx_session_config_org ON session_configurations(organization_id);

-- Table for active user sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Session identification
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE,   -- Hashed token for security

  -- Session details
  session_type VARCHAR(100),                     -- 'web', 'mobile', 'api', 'admin'
  session_name VARCHAR(255),

  -- Session timeline
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  renewed_at TIMESTAMP WITH TIME ZONE,

  -- Device information
  device_id VARCHAR(255),
  device_fingerprint VARCHAR(255),
  device_name VARCHAR(255),
  device_type VARCHAR(50),                       -- 'desktop', 'mobile', 'tablet'
  device_os VARCHAR(100),
  device_browser VARCHAR(100),
  is_device_trusted BOOLEAN DEFAULT false,
  device_approved_at TIMESTAMP WITH TIME ZONE,
  device_approval_required BOOLEAN DEFAULT false,

  -- Location and IP
  ip_address INET,
  geolocation JSONB,                            -- {latitude, longitude, city, country}
  user_agent TEXT,

  -- Authentication
  authentication_method VARCHAR(50),             -- 'password', '2fa', 'sso', 'api_key', 'oauth'
  authenticated_at TIMESTAMP WITH TIME ZONE,
  twofa_verified BOOLEAN DEFAULT false,
  twofa_verified_at TIMESTAMP WITH TIME ZONE,

  -- Security
  is_active BOOLEAN DEFAULT true,
  is_expired BOOLEAN DEFAULT false,
  is_revoked BOOLEAN DEFAULT false,
  revoke_reason TEXT,
  revoked_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  session_metadata JSONB,                        -- Custom data per session
  last_ip_change TIMESTAMP WITH TIME ZONE,

  CONSTRAINT fk_session_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_org ON user_sessions(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON user_sessions(expires_at, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON user_sessions(device_id, is_trusted);

-- Table for authentication methods per user/org
CREATE TABLE IF NOT EXISTS authentication_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Method identification
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  auth_method_type VARCHAR(50) NOT NULL,        -- 'password', '2fa_totp', '2fa_sms', '2fa_email', 'sso_saml', 'sso_oauth', 'api_key', 'certificate'

  -- Configuration
  is_primary BOOLEAN DEFAULT false,              -- Primary auth method for login
  is_backup BOOLEAN DEFAULT false,               -- Backup method if primary fails
  is_active BOOLEAN DEFAULT true,
  requires_setup BOOLEAN DEFAULT true,
  setup_completed_at TIMESTAMP WITH TIME ZONE,

  -- Method-specific data (encrypted in practice)
  method_data JSONB,                            -- {provider, provider_id, key_id, phone, email, etc}

  -- 2FA specifics
  twofa_backup_codes_generated BOOLEAN DEFAULT false,
  twofa_backup_codes_used INT DEFAULT 0,
  twofa_last_used TIMESTAMP WITH TIME ZONE,

  -- API Key specifics
  api_key_hash VARCHAR(255),                    -- Hashed API key
  api_key_name VARCHAR(255),
  api_key_last_rotated TIMESTAMP WITH TIME ZONE,
  api_key_next_rotation TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT fk_auth_method_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_methods_user ON authentication_methods(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_auth_methods_type ON authentication_methods(auth_method_type);
CREATE INDEX IF NOT EXISTS idx_auth_methods_primary ON authentication_methods(user_id, is_primary);

-- Table for API keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Key identification
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  api_key_name VARCHAR(255) NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,           -- Hash of actual key

  -- Key type
  key_type VARCHAR(50),                         -- 'personal', 'service_account', 'integration', 'webhook'
  scope VARCHAR(255),                           -- Permissions: 'read:users,write:reports'

  -- Lifetime
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE,
  rotated_at TIMESTAMP WITH TIME ZONE,
  next_rotation_at TIMESTAMP WITH TIME ZONE,
  rotation_interval_days INT DEFAULT 90,

  -- Usage tracking
  last_used_at TIMESTAMP WITH TIME ZONE,
  last_used_ip INET,
  usage_count INT DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_revoked BOOLEAN DEFAULT false,
  revoke_reason TEXT,
  revoked_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT fk_api_key_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at);

-- Table for trusted devices
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Device identification
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  device_fingerprint VARCHAR(255),

  -- Device details
  device_name VARCHAR(255),
  device_type VARCHAR(50),                      -- 'desktop', 'mobile', 'tablet'
  device_os VARCHAR(100),
  device_browser VARCHAR(100),
  last_ip_address INET,

  -- Trust status
  is_trusted BOOLEAN DEFAULT false,
  trust_approved_at TIMESTAMP WITH TIME ZONE,
  trust_approved_by VARCHAR(255),
  trust_approval_method VARCHAR(50),            -- 'manual', 'email', 'sms', 'push_notification'

  -- Risk assessment
  risk_level VARCHAR(50),                       -- 'low', 'medium', 'high', 'critical'
  risk_score INT DEFAULT 0,
  risk_factors JSONB,                           -- What raised the risk score

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  last_suspicious_activity TIMESTAMP WITH TIME ZONE,

  UNIQUE(user_id, device_fingerprint),
  CONSTRAINT fk_device_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id, is_trusted);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_risk ON trusted_devices(risk_level);

-- Table for authentication failures and suspicious activity
CREATE TABLE IF NOT EXISTS authentication_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identification
  user_id VARCHAR(255),                         -- NULL for failed login (unknown user)
  organization_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,             -- 'login_success', 'login_failed', 'login_required_2fa', 'twofa_verified', 'twofa_failed', 'password_changed', 'api_key_created', 'device_added', 'device_removed', 'suspicious_activity'
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Event details
  username_attempted VARCHAR(255),              -- For login attempts
  authentication_method VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  device_id VARCHAR(255),

  -- Result
  success BOOLEAN DEFAULT false,
  failure_reason TEXT,

  -- Security
  is_suspicious BOOLEAN DEFAULT false,
  flagged_for_review BOOLEAN DEFAULT false,
  security_alert_sent BOOLEAN DEFAULT false,

  -- Context
  session_id UUID REFERENCES user_sessions(id),
  metadata JSONB,

  CONSTRAINT fk_auth_event_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user ON authentication_events(user_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_type ON authentication_events(event_type, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_suspicious ON authentication_events(is_suspicious);
CREATE INDEX IF NOT EXISTS idx_auth_events_failed ON authentication_events(success) WHERE success = false;

-- Table for 2FA/MFA configuration
CREATE TABLE IF NOT EXISTS twofactor_configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Configuration identification
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  twofa_method VARCHAR(50) NOT NULL,            -- 'totp', 'sms', 'email', 'push', 'hardware_key'
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- TOTP specifics (Time-based One-Time Password)
  totp_secret VARCHAR(255),
  totp_backup_codes TEXT[],                     -- Encrypted backup codes
  totp_window INT DEFAULT 1,                    -- Accept N previous/next time windows

  -- SMS/Email specifics
  phone_number VARCHAR(20),
  email_address VARCHAR(255),
  verified_phone BOOLEAN DEFAULT false,
  verified_email BOOLEAN DEFAULT false,

  -- Hardware key specifics
  hardware_key_type VARCHAR(50),                -- 'fido2', 'yubikey', 'windows_hello'
  hardware_key_id VARCHAR(255),
  hardware_key_name VARCHAR(255),

  -- Push notification specifics
  push_provider VARCHAR(50),                    -- 'firebase', 'apns', 'custom'
  push_device_tokens JSONB,

  -- Configuration
  require_always BOOLEAN DEFAULT false,         -- Always require 2FA, not just on new device
  require_for_sensitive_operations BOOLEAN DEFAULT true,
  trusted_device_bypass BOOLEAN DEFAULT true,   -- Skip 2FA on trusted devices

  -- Metadata
  setup_completed_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  disabled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, twofa_method),
  CONSTRAINT fk_twofa_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_twofa_user ON twofactor_configuration(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_twofa_method ON twofactor_configuration(twofa_method);

-- Table for password policy per organization
CREATE TABLE IF NOT EXISTS password_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Policy identification
  organization_id VARCHAR(255) NOT NULL UNIQUE,
  policy_name VARCHAR(255),

  -- Password requirements
  min_length INT DEFAULT 12,
  max_length INT DEFAULT 128,
  require_uppercase BOOLEAN DEFAULT true,
  require_lowercase BOOLEAN DEFAULT true,
  require_numbers BOOLEAN DEFAULT true,
  require_special_chars BOOLEAN DEFAULT true,
  special_chars_allowed VARCHAR(100) DEFAULT '!@#$%^&*()_+-=[]{}|;:,.<>?',

  -- Password history
  remember_history_count INT DEFAULT 5,         -- Cannot reuse last N passwords
  password_expiry_days INT DEFAULT 90,          -- Force password change after N days (null = never)
  password_warning_days INT DEFAULT 14,         -- Warn user N days before expiry

  -- Account lockout
  max_login_attempts INT DEFAULT 5,
  lockout_duration_minutes INT DEFAULT 15,
  must_change_on_first_login BOOLEAN DEFAULT true,
  must_change_on_reset BOOLEAN DEFAULT true,

  -- Strength validation
  strength_calculator VARCHAR(50),              -- 'zxcvbn', 'owasp', 'custom'
  min_strength_score INT DEFAULT 3,             -- 0-4 scale

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_password_policy_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_policy_active ON password_policies(is_active);

-- Table for password history and resets
CREATE TABLE IF NOT EXISTS password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Password history identification
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_change_type VARCHAR(50),             -- 'user_change', 'admin_reset', 'forced_reset', 'password_recovery'

  -- Timeline
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE,         -- When password expires
  last_used_at TIMESTAMP WITH TIME ZONE,

  -- Reset specifics
  reset_token VARCHAR(255),
  reset_token_expires_at TIMESTAMP WITH TIME ZONE,
  reset_requested_at TIMESTAMP WITH TIME ZONE,
  reset_requested_by VARCHAR(255),

  CONSTRAINT fk_password_history_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_history_reset ON password_history(reset_token);

-- Table for single sign-on (SSO) configuration
CREATE TABLE IF NOT EXISTS sso_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Configuration identification
  organization_id VARCHAR(255) NOT NULL,
  provider_name VARCHAR(100) NOT NULL,          -- 'saml', 'oauth2', 'oidc', 'ldap'
  provider_type VARCHAR(50),                    -- 'okta', 'azure_ad', 'google', 'custom'
  display_name VARCHAR(255),

  -- Provider credentials
  client_id VARCHAR(255),
  client_secret VARCHAR(255),                   -- Encrypted in practice
  provider_url VARCHAR(255),
  metadata_url VARCHAR(255),
  metadata JSONB,

  -- Configuration options
  is_primary_auth BOOLEAN DEFAULT false,
  auto_provision_users BOOLEAN DEFAULT true,    -- Create user on first login
  force_user_provision BOOLEAN DEFAULT false,   -- All users must use SSO
  sync_user_roles BOOLEAN DEFAULT false,        -- Sync roles from SSO provider
  sync_user_groups BOOLEAN DEFAULT false,       -- Sync group membership

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  verification_status TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync TIMESTAMP WITH TIME ZONE,

  UNIQUE(organization_id, provider_name),
  CONSTRAINT fk_sso_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sso_org ON sso_configurations(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sso_provider ON sso_configurations(provider_type);

-- View for active sessions summary
CREATE OR REPLACE VIEW active_sessions_summary AS
SELECT
  organization_id,
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) as total_sessions,
  COUNT(CASE WHEN is_active = true AND is_expired = false AND is_revoked = false THEN 1 END) as valid_sessions,
  COUNT(CASE WHEN device_approved_at IS NOT NULL THEN 1 END) as approved_devices,
  COUNT(DISTINCT device_type) as device_types
FROM user_sessions
WHERE is_active = true AND is_expired = false
GROUP BY organization_id;

-- View for authentication summary
CREATE OR REPLACE VIEW authentication_summary AS
SELECT
  event_type,
  COUNT(*) as total_events,
  COUNT(CASE WHEN success = true THEN 1 END) as successful,
  COUNT(CASE WHEN success = false THEN 1 END) as failed,
  COUNT(CASE WHEN is_suspicious = true THEN 1 END) as suspicious,
  MAX(event_timestamp) as most_recent
FROM authentication_events
WHERE event_timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY event_type;

-- View for api key status
CREATE OR REPLACE VIEW api_key_status_summary AS
SELECT
  user_id,
  COUNT(*) as total_keys,
  COUNT(CASE WHEN is_active = true AND is_revoked = false THEN 1 END) as active_keys,
  COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP THEN 1 END) as expired_keys,
  COUNT(CASE WHEN next_rotation_at < CURRENT_TIMESTAMP THEN 1 END) as keys_needing_rotation,
  MAX(last_used_at) as most_recent_usage
FROM api_keys
GROUP BY user_id;

-- Update trigger for session configuration
CREATE OR REPLACE FUNCTION update_session_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_config_update ON session_configurations;
CREATE TRIGGER session_config_update BEFORE UPDATE ON session_configurations
FOR EACH ROW EXECUTE FUNCTION update_session_config_timestamp();

-- Comments
COMMENT ON TABLE session_configurations IS 'Define session policies per organization and session type (web/mobile/api/admin)';
COMMENT ON TABLE user_sessions IS 'Track active user sessions with device, location, and security information';
COMMENT ON TABLE authentication_methods IS 'Track available authentication methods for each user (password, 2FA, SSO, API key)';
COMMENT ON TABLE api_keys IS 'Manage API keys with rotation schedules and usage tracking';
COMMENT ON TABLE trusted_devices IS 'Track and trust user devices for reduced friction authentication';
COMMENT ON TABLE authentication_events IS 'Audit trail of all authentication attempts and events';
COMMENT ON TABLE twofactor_configuration IS 'Configure 2FA methods per user (TOTP, SMS, email, hardware key, push)';
COMMENT ON TABLE password_policies IS 'Define password requirements and expiry policies per organization';
COMMENT ON TABLE password_history IS 'Track password changes and resets with history validation';
COMMENT ON TABLE sso_configurations IS 'Configure single sign-on providers (SAML, OAuth, OIDC, LDAP) per organization';
