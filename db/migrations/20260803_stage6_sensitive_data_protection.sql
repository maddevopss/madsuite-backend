-- Migration: Stage 6 Sensitive Data Protection
-- Encryption, masking, retention, and data classification for sensitive information

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT 'Default organization',
  slug VARCHAR(255) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table for data classification and sensitivity levels
CREATE TABLE IF NOT EXISTS data_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification details
  classification_name VARCHAR(100) NOT NULL UNIQUE,
  classification_level INT NOT NULL,                -- 1=public, 2=internal, 3=confidential, 4=restricted, 5=highly_restricted
  description TEXT,

  -- Protection requirements
  requires_encryption BOOLEAN DEFAULT true,        -- Must be encrypted at rest
  requires_masking BOOLEAN DEFAULT false,          -- Must be masked in logs/exports
  requires_audit_log BOOLEAN DEFAULT true,         -- Log all accesses
  requires_access_approval BOOLEAN DEFAULT false,  -- Requires approval to access
  requires_twofa_for_access BOOLEAN DEFAULT false, -- 2FA to access
  maximum_retention_days INT,                      -- How long to keep after creation
  minimum_encryption_strength VARCHAR(50),         -- 'AES-256', 'AES-192', etc

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_classifications_level ON data_classifications(classification_level);
CREATE INDEX IF NOT EXISTS idx_classifications_active ON data_classifications(is_active);

-- Table for data field definitions with classification
CREATE TABLE IF NOT EXISTS data_field_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Field identification
  table_name VARCHAR(100) NOT NULL,
  column_name VARCHAR(100) NOT NULL,
  organization_id VARCHAR(255),                  -- NULL = global classification

  -- Classification
  data_classification_id UUID NOT NULL REFERENCES data_classifications(id),

  -- Field-specific overrides
  masking_pattern VARCHAR(255),                  -- Regex pattern for masking (e.g., 'XXX-XX-\d{4}' for SSN)
  pii_type VARCHAR(100),                         -- 'ssn', 'email', 'phone', 'credit_card', 'name', 'address', etc
  retention_override_days INT,                   -- Override default retention for this field
  encryption_key_id VARCHAR(255),                -- Reference to encryption key

  -- Access control
  access_require_approval BOOLEAN DEFAULT false,
  access_log_all_reads BOOLEAN DEFAULT false,    -- Log even read access
  access_redact_in_audit BOOLEAN DEFAULT true,   -- Redact actual values in audit logs

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(table_name, column_name, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_field_classifications_table ON data_field_classifications(table_name);
CREATE INDEX IF NOT EXISTS idx_field_classifications_pii ON data_field_classifications(pii_type);
CREATE INDEX IF NOT EXISTS idx_field_classifications_org ON data_field_classifications(organization_id);

-- Table for data encryption keys and rotation
CREATE TABLE IF NOT EXISTS encryption_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Key identification
  key_name VARCHAR(255) NOT NULL,
  key_id VARCHAR(255) NOT NULL UNIQUE,           -- External key management reference
  key_algorithm VARCHAR(50),                     -- 'AES-256-GCM', 'RSA-4096', etc
  key_type VARCHAR(50),                          -- 'data_encryption', 'key_encryption', 'backup', 'archive'

  -- Rotation
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at TIMESTAMP WITH TIME ZONE,
  next_rotation_at TIMESTAMP WITH TIME ZONE,
  rotation_interval_days INT,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_retired BOOLEAN DEFAULT false,              -- Still used for decryption, not encryption
  uses_external_kms BOOLEAN DEFAULT true,        -- Uses AWS KMS, Azure Key Vault, etc

  -- Metadata
  organization_id VARCHAR(255) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_retired ON encryption_keys(is_retired);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_rotation ON encryption_keys(next_rotation_at);

-- Table for data retention policies
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Policy identification
  policy_name VARCHAR(255) NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  organization_id VARCHAR(255),

  -- Retention rules
  retention_type VARCHAR(50),                    -- 'delete', 'archive', 'anonymize'
  retention_days INT NOT NULL,
  retention_trigger VARCHAR(100),                -- 'creation_date', 'modification_date', 'last_access', 'custom'

  -- Archive settings (if retention_type = 'archive')
  archive_location VARCHAR(255),                 -- S3 bucket, Azure blob, etc
  archive_after_days INT,                        -- Move to archive after N days

  -- Anonymization settings (if retention_type = 'anonymize')
  anonymization_method VARCHAR(100),             -- 'masking', 'pseudonymization', 'differential_privacy'

  -- Deletion settings (if retention_type = 'delete')
  delete_safely BOOLEAN DEFAULT true,            -- Secure deletion, not just DB delete
  require_approval_for_deletion BOOLEAN DEFAULT false,

  -- Exceptions
  exception_conditions JSONB,                    -- Conditions where retention doesn't apply
  hold_on_deletion BOOLEAN DEFAULT false,        -- Legal hold

  -- Status
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_retention_policy_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_table ON data_retention_policies(table_name);
CREATE INDEX IF NOT EXISTS idx_retention_policies_active ON data_retention_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_retention_policies_org ON data_retention_policies(organization_id);

-- Table for tracking encrypted data and keys used
CREATE TABLE IF NOT EXISTS encrypted_data_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Data reference
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(255) NOT NULL,
  column_name VARCHAR(100) NOT NULL,

  -- Encryption details
  encryption_key_id VARCHAR(255) NOT NULL,
  encrypted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encryption_algorithm VARCHAR(50),
  data_hash VARCHAR(255),                        -- Hash to detect tampering

  -- Data classification
  data_classification_id UUID REFERENCES data_classifications(id),
  pii_type VARCHAR(100),

  -- Metadata
  organization_id VARCHAR(255) NOT NULL,

  CONSTRAINT fk_encrypted_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_encrypted_data_table ON encrypted_data_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_encrypted_data_pii ON encrypted_data_log(pii_type);
CREATE INDEX IF NOT EXISTS idx_encrypted_data_key ON encrypted_data_log(encryption_key_id);

-- Table for data access logging and audit trail
CREATE TABLE IF NOT EXISTS data_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Access details
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  access_type VARCHAR(50) NOT NULL,              -- 'read', 'export', 'download', 'api_access'
  access_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Data accessed
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(255),
  column_name VARCHAR(100),
  affected_pii_types JSONB,                      -- PII types in accessed data

  -- Access context
  access_method VARCHAR(100),                    -- 'direct_db', 'api', 'export', 'report', 'admin_panel'
  request_id VARCHAR(255),                       -- Trace back to request
  ip_address INET,
  user_agent TEXT,

  -- Security
  requires_audit_entry BOOLEAN DEFAULT true,
  flagged_for_review BOOLEAN DEFAULT false,
  access_approved BOOLEAN DEFAULT true,
  access_denial_reason TEXT,

  -- Data retention
  redacted_in_longterm_storage BOOLEAN DEFAULT true,

  CONSTRAINT fk_access_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_log_user ON data_access_log(user_id, access_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_table ON data_access_log(table_name, access_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_pii ON data_access_log(affected_pii_types);
CREATE INDEX IF NOT EXISTS idx_access_log_flagged ON data_access_log(flagged_for_review);

-- Table for PII detection and classification
CREATE TABLE IF NOT EXISTS pii_detection_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule identification
  rule_name VARCHAR(255) NOT NULL,
  pii_type VARCHAR(100) NOT NULL UNIQUE,        -- 'ssn', 'email', 'phone', 'credit_card', 'name', 'address', 'ip_address', 'account_number'
  description TEXT,

  -- Detection pattern
  detection_pattern VARCHAR(1000),               -- Regex pattern for detection
  pattern_examples JSONB,                        -- Example values that match

  -- Masking configuration
  masking_pattern VARCHAR(255),                  -- How to mask this PII type
  masking_examples JSONB,

  -- Classification
  default_classification_level INT,              -- Default classification for this PII type
  requires_encryption BOOLEAN DEFAULT true,
  requires_access_approval BOOLEAN DEFAULT false,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_pii_type CHECK (pii_type <> '')
);

CREATE INDEX IF NOT EXISTS idx_pii_rules_type ON pii_detection_rules(pii_type);
CREATE INDEX IF NOT EXISTS idx_pii_rules_active ON pii_detection_rules(is_active);

-- Table for data masking and redaction rules
CREATE TABLE IF NOT EXISTS data_masking_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule identification
  rule_name VARCHAR(255) NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  column_name VARCHAR(100) NOT NULL,

  -- Masking method
  masking_method VARCHAR(100) NOT NULL,         -- 'full_redact', 'partial_redact', 'shuffle', 'hash', 'null', 'custom'
  masking_pattern VARCHAR(255),                 -- Pattern for masking (e.g., 'XXX-XX-\d{4}')

  -- Where to apply
  apply_to_contexts JSONB,                      -- 'logs', 'reports', 'exports', 'admin_view', 'customer_view'
  apply_by_role JSONB,                          -- Roles that see masked data

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(table_name, column_name)
);

CREATE INDEX IF NOT EXISTS idx_masking_rules_table ON data_masking_rules(table_name);
CREATE INDEX IF NOT EXISTS idx_masking_rules_active ON data_masking_rules(is_active);

-- Table for data export and download tracking
CREATE TABLE IF NOT EXISTS data_export_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Export details
  export_id VARCHAR(255) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  export_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- What was exported
  export_type VARCHAR(50),                       -- 'csv', 'json', 'excel', 'api_response', 'report'
  table_names JSONB NOT NULL,                   -- Tables included
  record_count INT NOT NULL,
  pii_types_included JSONB,                      -- PII types in export

  -- Export method
  export_method VARCHAR(100),                    -- 'direct_download', 'email', 'api', 'report_generation'
  destination VARCHAR(255),                      -- Email, API endpoint, etc
  file_hash VARCHAR(255),                        -- Hash of exported file

  -- Security
  includes_encrypted_data BOOLEAN DEFAULT false,
  includes_masked_data BOOLEAN DEFAULT true,
  exported_data_redacted BOOLEAN DEFAULT true,   -- Was sensitive data redacted?
  approval_id UUID REFERENCES operation_approvals(id),

  -- Retention
  retention_until TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT fk_export_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_export_log_user ON data_export_log(user_id, export_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_export_log_org ON data_export_log(organization_id, export_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_export_log_pii ON data_export_log(pii_types_included);

-- Table for data breach detection and response
CREATE TABLE IF NOT EXISTS data_breach_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Incident details
  incident_name VARCHAR(255) NOT NULL,
  organization_id VARCHAR(255) NOT NULL,
  detection_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reported_timestamp TIMESTAMP WITH TIME ZONE,

  -- Breach scope
  breach_type VARCHAR(100),                      -- 'unauthorized_access', 'data_leak', 'ransomware', 'insider_threat', 'configuration_exposure'
  affected_tables JSONB NOT NULL,
  affected_records_count INT,
  affected_pii_types JSONB,                      -- Which PII types were exposed

  -- Response
  immediate_actions JSONB,                       -- Actions taken immediately
  investigation_findings TEXT,
  root_cause TEXT,
  remediation_plan TEXT,
  remediation_complete BOOLEAN DEFAULT false,

  -- Notification
  users_notified BOOLEAN DEFAULT false,
  notification_timestamp TIMESTAMP WITH TIME ZONE,
  regulators_notified BOOLEAN DEFAULT false,
  regulatory_authority VARCHAR(255),

  -- Status
  status VARCHAR(50),                            -- 'detected', 'investigating', 'contained', 'remediated', 'closed'
  severity_level VARCHAR(50),                    -- 'critical', 'high', 'medium', 'low'
  status_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_breach_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_breach_org ON data_breach_incidents(organization_id, detection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_breach_status ON data_breach_incidents(status);
CREATE INDEX IF NOT EXISTS idx_breach_severity ON data_breach_incidents(severity_level);

-- View for data classification summary
CREATE OR REPLACE VIEW data_protection_summary AS
SELECT
  dc.classification_name,
  dc.classification_level,
  COUNT(DISTINCT dfc.id) as fields_classified,
  COUNT(DISTINCT CASE WHEN dfc.access_log_all_reads = true THEN dfc.id END) as fields_with_read_logging,
  COUNT(DISTINCT CASE WHEN dfc.access_require_approval = true THEN dfc.id END) as fields_requiring_approval,
  COUNT(DISTINCT CASE WHEN dfc.pii_type IS NOT NULL THEN dfc.id END) as pii_fields
FROM data_classifications dc
LEFT JOIN data_field_classifications dfc ON dfc.data_classification_id = dc.id
WHERE dc.is_active = true
GROUP BY dc.id, dc.classification_name, dc.classification_level;

-- View for encryption key status
CREATE OR REPLACE VIEW encryption_key_status AS
SELECT
  key_name,
  key_algorithm,
  is_active,
  is_retired,
  EXTRACT(DAY FROM (next_rotation_at - CURRENT_TIMESTAMP)) as days_until_rotation,
  CASE
    WHEN next_rotation_at < CURRENT_TIMESTAMP THEN 'OVERDUE'
    WHEN next_rotation_at < CURRENT_TIMESTAMP + INTERVAL '30 days' THEN 'DUE_SOON'
    ELSE 'OK'
  END as rotation_status
FROM encryption_keys
ORDER BY next_rotation_at ASC NULLS LAST;

-- View for data access audit trail
CREATE OR REPLACE VIEW recent_data_access_summary AS
SELECT
  table_name,
  access_type,
  COUNT(*) as access_count,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(CASE WHEN flagged_for_review = true THEN 1 END) as flagged_accesses,
  MAX(access_timestamp) as most_recent_access
FROM data_access_log
WHERE access_timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY table_name, access_type;

-- View for PII exposure tracking
CREATE OR REPLACE VIEW pii_exposure_summary AS
SELECT
  pii_type,
  COUNT(DISTINCT table_name) as tables_with_pii,
  COUNT(DISTINCT record_id) as records_with_pii,
  COUNT(CASE WHEN access_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as accesses_last_24h,
  COUNT(DISTINCT user_id) as users_accessed_pii
FROM data_access_log
WHERE affected_pii_types IS NOT NULL
GROUP BY pii_type;

-- Update trigger for data classifications
CREATE OR REPLACE FUNCTION update_classification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classification_update ON data_classifications;
CREATE TRIGGER classification_update BEFORE UPDATE ON data_classifications
FOR EACH ROW EXECUTE FUNCTION update_classification_timestamp();

-- Update trigger for retention policies
DROP TRIGGER IF EXISTS retention_policy_update ON data_retention_policies;
CREATE TRIGGER retention_policy_update BEFORE UPDATE ON data_retention_policies
FOR EACH ROW EXECUTE FUNCTION update_classification_timestamp();

-- Comments
COMMENT ON TABLE data_classifications IS 'Define data sensitivity levels and protection requirements (public to highly-restricted)';
COMMENT ON TABLE data_field_classifications IS 'Map specific table columns to classifications with masking and access rules';
COMMENT ON TABLE encryption_keys IS 'Manage encryption keys with rotation schedules and KMS integration';
COMMENT ON TABLE data_retention_policies IS 'Define how long data is kept (delete, archive, anonymize)';
COMMENT ON TABLE encrypted_data_log IS 'Audit trail of which keys encrypted which data';
COMMENT ON TABLE data_access_log IS 'Complete log of all data access with PII type tracking';
COMMENT ON TABLE pii_detection_rules IS 'Patterns to auto-detect PII types (SSN, email, phone, etc)';
COMMENT ON TABLE data_masking_rules IS 'Rules for redacting sensitive data in logs/exports/reports';
COMMENT ON TABLE data_export_log IS 'Track all data exports with what PII was included';
COMMENT ON TABLE data_breach_incidents IS 'Record and track data breach detection, response, and remediation';
