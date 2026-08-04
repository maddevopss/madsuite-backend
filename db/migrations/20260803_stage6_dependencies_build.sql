-- Migration: Stage 6 Dependencies & Build Chain
-- Dependency tracking, build verification, supply chain security, and integrity checks

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT 'Default organization',
  slug VARCHAR(255) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table for package dependencies and versions
CREATE TABLE IF NOT EXISTS package_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dependency identification
  package_name VARCHAR(255) NOT NULL,
  package_version VARCHAR(100) NOT NULL,
  package_type VARCHAR(50),                      -- 'npm', 'pip', 'maven', 'gem', 'cargo'
  registry_source VARCHAR(255),                  -- 'npm', 'pypi', 'maven_central', 'rubygems', 'crates.io'

  -- Dependency details
  organization_id VARCHAR(255),
  environment VARCHAR(50),                       -- 'production', 'development', 'test', 'all'
  dependency_type VARCHAR(50),                   -- 'direct', 'transitive', 'optional'
  is_dev_dependency BOOLEAN DEFAULT false,

  -- Compatibility
  compatible_versions VARCHAR(100),              -- Version range specification
  current_version_satisfies BOOLEAN DEFAULT true,
  upgrade_available VARCHAR(100),

  -- Security and maintenance
  is_active BOOLEAN DEFAULT true,
  requires_review BOOLEAN DEFAULT false,
  marked_for_removal BOOLEAN DEFAULT false,
  removal_reason TEXT,

  -- Metadata
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE,

  UNIQUE(package_name, package_version),
  CONSTRAINT fk_dependency_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dependencies_name ON package_dependencies(package_name);
CREATE INDEX IF NOT EXISTS idx_dependencies_type ON package_dependencies(package_type);
CREATE INDEX IF NOT EXISTS idx_dependencies_active ON package_dependencies(is_active);
CREATE INDEX IF NOT EXISTS idx_dependencies_vulnerable ON package_dependencies(requires_review);

-- Table for vulnerability alerts on dependencies
CREATE TABLE IF NOT EXISTS dependency_vulnerabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vulnerability identification
  package_dependency_id UUID NOT NULL REFERENCES package_dependencies(id) ON DELETE CASCADE,
  vulnerability_id VARCHAR(255) NOT NULL,       -- CVE-XXXX-XXXXX or GitHub Advisory ID
  vulnerability_source VARCHAR(100),            -- 'nvd', 'github', 'snyk', 'sonatype', 'bundler_audit'

  -- Vulnerability details
  severity_level VARCHAR(50),                   -- 'critical', 'high', 'medium', 'low'
  cvss_score DECIMAL(3,1),
  description TEXT,
  affected_versions VARCHAR(100),
  patched_versions VARCHAR(100),

  -- Discovery and tracking
  discovered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_alerted_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remediated_at TIMESTAMP WITH TIME ZONE,

  -- Remediation status
  status VARCHAR(50),                           -- 'open', 'reviewed', 'accepted_risk', 'patched', 'resolved'
  remediation_plan TEXT,
  requires_upgrade BOOLEAN DEFAULT true,
  upgrade_to_version VARCHAR(100),

  -- References
  cve_reference VARCHAR(255),
  advisory_url VARCHAR(500),

  UNIQUE(package_dependency_id, vulnerability_id)
);

CREATE INDEX IF NOT EXISTS idx_vulns_severity ON dependency_vulnerabilities(severity_level);
CREATE INDEX IF NOT EXISTS idx_vulns_status ON dependency_vulnerabilities(status);
CREATE INDEX IF NOT EXISTS idx_vulns_package ON dependency_vulnerabilities(package_dependency_id);

-- Table for build configurations
CREATE TABLE IF NOT EXISTS build_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Build identification
  build_id VARCHAR(255) NOT NULL UNIQUE,
  organization_id VARCHAR(255) NOT NULL,
  build_type VARCHAR(50),                       -- 'ci', 'release', 'hotfix', 'nightly', 'manual'
  build_name VARCHAR(255),

  -- Git details
  repository_url VARCHAR(500),
  branch_name VARCHAR(255),
  commit_hash VARCHAR(40),
  commit_message TEXT,
  tagged_release VARCHAR(100),

  -- Build timing
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_minutes INT,

  -- Build status
  status VARCHAR(50),                           -- 'pending', 'building', 'testing', 'passed', 'failed', 'blocked'
  build_log_url VARCHAR(500),
  build_artifacts_url VARCHAR(500),

  -- Quality checks
  compilation_passed BOOLEAN,
  unit_tests_passed BOOLEAN,
  integration_tests_passed BOOLEAN,
  security_scan_passed BOOLEAN,
  lint_check_passed BOOLEAN,
  coverage_percentage DECIMAL(5,2),

  -- Security verification
  signed_commit BOOLEAN DEFAULT false,
  signed_artifacts BOOLEAN DEFAULT false,
  gpg_key_id VARCHAR(255),
  sbom_generated BOOLEAN DEFAULT false,

  -- Dependency validation
  dependencies_scanned BOOLEAN DEFAULT false,
  vulnerabilities_found INT DEFAULT 0,
  critical_vulnerabilities INT DEFAULT 0,
  dependency_validation_passed BOOLEAN,

  -- Metadata
  triggered_by VARCHAR(255),
  build_environment VARCHAR(100),               -- 'local', 'ci_server', 'cloud_build'

  CONSTRAINT fk_build_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_builds_status ON build_configurations(status);
CREATE INDEX IF NOT EXISTS idx_builds_org ON build_configurations(organization_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_builds_security ON build_configurations(security_scan_passed);

-- Table for build artifacts
CREATE TABLE IF NOT EXISTS build_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Artifact identification
  build_id UUID NOT NULL REFERENCES build_configurations(id) ON DELETE CASCADE,
  artifact_name VARCHAR(255) NOT NULL,
  artifact_type VARCHAR(50),                    -- 'docker_image', 'jar', 'wheel', 'npm_package', 'binary', 'archive'
  artifact_version VARCHAR(100),

  -- Artifact storage
  artifact_location VARCHAR(500),               -- S3, Docker Hub, npm registry, etc
  artifact_size_bytes BIGINT,

  -- Integrity verification
  artifact_hash VARCHAR(255),                   -- SHA256 hash
  artifact_signature VARCHAR(500),              -- Cryptographic signature
  signature_algorithm VARCHAR(50),              -- 'rsa', 'ecdsa', 'ed25519'
  signature_verified BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP WITH TIME ZONE,
  is_published BOOLEAN DEFAULT false,
  is_deprecated BOOLEAN DEFAULT false,
  deprecation_reason TEXT,

  CONSTRAINT fk_artifact_build FOREIGN KEY (build_id) REFERENCES build_configurations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_build ON build_artifacts(build_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON build_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_published ON build_artifacts(is_published);

-- Table for dependency lock files and snapshots
CREATE TABLE IF NOT EXISTS dependency_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lock file identification
  organization_id VARCHAR(255) NOT NULL,
  lock_file_type VARCHAR(50),                   -- 'package-lock.json', 'yarn.lock', 'Pipfile.lock', 'Gemfile.lock', 'Cargo.lock'
  lock_file_version VARCHAR(100),
  lock_file_hash VARCHAR(255),

  -- Lock details
  locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by VARCHAR(255),
  lock_git_commit VARCHAR(40),
  lock_branch VARCHAR(255),

  -- Dependencies included
  total_dependencies INT,
  direct_dependencies INT,
  transitive_dependencies INT,
  dev_dependencies INT,

  -- Validation
  is_valid BOOLEAN DEFAULT true,
  validation_errors JSONB,

  -- Status
  is_current BOOLEAN DEFAULT true,
  archived_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT fk_lock_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_locks_org ON dependency_locks(organization_id, locked_at DESC);
CREATE INDEX IF NOT EXISTS idx_locks_current ON dependency_locks(is_current);

-- Table for software bill of materials (SBOM)
CREATE TABLE IF NOT EXISTS software_bill_of_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SBOM identification
  build_id UUID NOT NULL REFERENCES build_configurations(id) ON DELETE CASCADE,
  sbom_format VARCHAR(50),                      -- 'cyclonedx', 'spdx', 'swid'
  sbom_version VARCHAR(100),
  sbom_hash VARCHAR(255),

  -- SBOM generation
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by VARCHAR(255),

  -- Component tracking
  component_count INT,
  license_count INT,
  components_with_unknown_license INT,
  components_with_copyleft_license INT,

  -- Compliance
  license_compliance_check_passed BOOLEAN,
  restricted_licenses_found BOOLEAN DEFAULT false,
  restricted_licenses JSONB,

  -- Content
  sbom_content JSONB,
  sbom_file_location VARCHAR(500),

  -- Verification
  signature_verified BOOLEAN DEFAULT false,

  CONSTRAINT fk_sbom_build FOREIGN KEY (build_id) REFERENCES build_configurations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sbom_build ON software_bill_of_materials(build_id);
CREATE INDEX IF NOT EXISTS idx_sbom_compliance ON software_bill_of_materials(license_compliance_check_passed);

-- Table for build policy compliance
CREATE TABLE IF NOT EXISTS build_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Policy identification
  organization_id VARCHAR(255) NOT NULL,
  policy_name VARCHAR(255) NOT NULL,
  policy_description TEXT,

  -- Requirements
  require_signed_commits BOOLEAN DEFAULT false,
  require_signed_artifacts BOOLEAN DEFAULT false,
  require_sbom_generation BOOLEAN DEFAULT false,
  require_security_scan BOOLEAN DEFAULT true,
  require_dependency_scan BOOLEAN DEFAULT true,
  require_unit_tests BOOLEAN DEFAULT true,
  require_integration_tests BOOLEAN DEFAULT true,
  require_code_coverage_percent INT DEFAULT 80,

  -- Vulnerability policy
  block_on_critical_vulnerabilities BOOLEAN DEFAULT true,
  block_on_high_vulnerabilities BOOLEAN DEFAULT false,
  allow_dev_dependencies_with_vulns BOOLEAN DEFAULT false,
  max_allowed_vulnerabilities INT DEFAULT 0,

  -- License policy
  enforce_license_compliance BOOLEAN DEFAULT false,
  forbidden_licenses JSONB,                    -- ['GPL-3.0', 'AGPL-3.0']
  allowed_licenses JSONB,                      -- Whitelist if set

  -- Build requirements
  require_ci_build BOOLEAN DEFAULT true,
  require_peer_review BOOLEAN DEFAULT true,
  min_peer_reviews INT DEFAULT 1,

  -- Status
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_build_policy_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_build_policies_org ON build_policies(organization_id, is_active);

-- Table for build policy violations
CREATE TABLE IF NOT EXISTS build_policy_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Violation identification
  build_id UUID NOT NULL REFERENCES build_configurations(id) ON DELETE CASCADE,
  build_policy_id UUID NOT NULL REFERENCES build_policies(id),
  violation_type VARCHAR(100),                  -- 'missing_signature', 'test_failure', 'security_scan_failed', 'vulnerability_found', 'coverage_below_threshold', 'license_violation'
  violation_severity VARCHAR(50),               -- 'critical', 'high', 'medium', 'low', 'info'

  -- Details
  violation_description TEXT,
  violation_details JSONB,

  -- Resolution
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_method VARCHAR(50),                -- 'waived', 'fixed', 'escalated'
  resolution_notes TEXT,
  waived_by VARCHAR(255),
  waived_until TIMESTAMP WITH TIME ZONE,

  -- Status
  status VARCHAR(50),                           -- 'open', 'acknowledged', 'waived', 'resolved', 'escalated'
  blocks_deployment BOOLEAN DEFAULT true,

  CONSTRAINT fk_violation_build FOREIGN KEY (build_id) REFERENCES build_configurations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_violations_build ON build_policy_violations(build_id);
CREATE INDEX IF NOT EXISTS idx_violations_status ON build_policy_violations(status);
CREATE INDEX IF NOT EXISTS idx_violations_blocking ON build_policy_violations(blocks_deployment);

-- View for dependency vulnerability summary
CREATE OR REPLACE VIEW dependency_vulnerability_summary AS
SELECT
  pd.package_name,
  pd.package_version,
  COUNT(DISTINCT dv.id) as total_vulnerabilities,
  COUNT(CASE WHEN dv.severity_level = 'critical' THEN 1 END) as critical_count,
  COUNT(CASE WHEN dv.severity_level = 'high' THEN 1 END) as high_count,
  COUNT(CASE WHEN dv.status = 'open' THEN 1 END) as open_vulnerabilities,
  MAX(dv.cvss_score) as max_cvss_score,
  MAX(dv.discovered_at) as most_recent_vulnerability
FROM package_dependencies pd
LEFT JOIN dependency_vulnerabilities dv ON dv.package_dependency_id = pd.id
GROUP BY pd.package_name, pd.package_version;

-- View for build status summary
CREATE OR REPLACE VIEW build_status_summary AS
SELECT
  organization_id,
  build_type,
  COUNT(*) as total_builds,
  COUNT(CASE WHEN status = 'passed' THEN 1 END) as passed_builds,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_builds,
  COUNT(CASE WHEN security_scan_passed = false THEN 1 END) as security_failures,
  COUNT(CASE WHEN dependency_validation_passed = false THEN 1 END) as dependency_failures,
  COUNT(CASE WHEN vulnerabilities_found > 0 THEN 1 END) as builds_with_vulnerabilities,
  AVG(duration_minutes) as avg_build_duration_minutes,
  MAX(completed_at) as most_recent_build
FROM build_configurations
WHERE completed_at IS NOT NULL
GROUP BY organization_id, build_type;

-- View for artifact integrity status
CREATE OR REPLACE VIEW artifact_integrity_summary AS
SELECT
  artifact_type,
  COUNT(*) as total_artifacts,
  COUNT(CASE WHEN signature_verified = true THEN 1 END) as verified_artifacts,
  COUNT(CASE WHEN is_published = true THEN 1 END) as published_artifacts,
  COUNT(CASE WHEN is_deprecated = true THEN 1 END) as deprecated_artifacts
FROM build_artifacts
GROUP BY artifact_type;

-- Update trigger for dependencies
CREATE OR REPLACE FUNCTION update_dependency_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dependency_update ON package_dependencies;
CREATE TRIGGER dependency_update BEFORE UPDATE ON package_dependencies
FOR EACH ROW EXECUTE FUNCTION update_dependency_timestamp();

-- Update trigger for build policies
DROP TRIGGER IF EXISTS build_policy_update ON build_policies;
CREATE TRIGGER build_policy_update BEFORE UPDATE ON build_policies
FOR EACH ROW EXECUTE FUNCTION update_dependency_timestamp();

-- Comments
COMMENT ON TABLE package_dependencies IS 'Track all project dependencies with version compatibility and security status';
COMMENT ON TABLE dependency_vulnerabilities IS 'Track security vulnerabilities in dependencies from multiple sources';
COMMENT ON TABLE build_configurations IS 'Record build execution with quality checks, security scans, and verification';
COMMENT ON TABLE build_artifacts IS 'Track build output with integrity verification and cryptographic signatures';
COMMENT ON TABLE dependency_locks IS 'Manage dependency lock files to ensure reproducible builds';
COMMENT ON TABLE software_bill_of_materials IS 'Generate and track SBOM for supply chain security and license compliance';
COMMENT ON TABLE build_policies IS 'Define build requirements and security policies per organization';
COMMENT ON TABLE build_policy_violations IS 'Record and track policy violations with resolution tracking';
-- Existing installations may have created this table before updated_at was introduced.
ALTER TABLE dependency_vulnerabilities
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
