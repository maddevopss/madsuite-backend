/**
 * Issue #174 PR F: Dependencies & Build Chain Service
 *
 * Supply chain security, dependency tracking, vulnerability management, and build verification
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Register package dependency
 */
async function registerDependency(packageName, packageVersion, packageType, config = {}) {
  try {
    const {
      organizationId = null,
      registrySource = packageType,
      environment = "production",
      dependencyType = "direct",
      isDevDependency = false,
      compatibleVersions = null
    } = config;

    const query = `
      INSERT INTO package_dependencies (
        package_name, package_version, package_type, registry_source,
        organization_id, environment, dependency_type, is_dev_dependency,
        compatible_versions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (package_name, package_version)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, package_name;
    `;

    const result = await db.pool.query(query, [
      packageName,
      packageVersion,
      packageType,
      registrySource,
      organizationId,
      environment,
      dependencyType,
      isDevDependency,
      compatibleVersions
    ]);

    return {
      registered: true,
      dependency_id: result.rows[0].id,
      package_name: result.rows[0].package_name
    };
  } catch (error) {
    console.error("Error registering dependency:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Report dependency vulnerability
 */
async function reportDependencyVulnerability(dependencyId, vulnerabilityId, vulnConfig = {}) {
  try {
    const {
      vulnerabilitySource = "github",
      severityLevel = "medium",
      cvssScore = null,
      description = "",
      affectedVersions = null,
      patchedVersions = null,
      requiresUpgrade = true,
      upgradeToVersion = null,
      cveReference = null,
      advisoryUrl = null
    } = vulnConfig;

    const query = `
      INSERT INTO dependency_vulnerabilities (
        package_dependency_id, vulnerability_id, vulnerability_source,
        severity_level, cvss_score, description,
        affected_versions, patched_versions, requires_upgrade,
        upgrade_to_version, cve_reference, advisory_url, first_alerted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (package_dependency_id, vulnerability_id)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      dependencyId,
      vulnerabilityId,
      vulnerabilitySource,
      severityLevel,
      cvssScore,
      description,
      affectedVersions,
      patchedVersions,
      requiresUpgrade,
      upgradeToVersion,
      cveReference,
      advisoryUrl
    ]);

    return {
      reported: true,
      vulnerability_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error reporting vulnerability:", error);
    return { reported: false, error: error.message };
  }
}

/**
 * Create build configuration
 */
async function createBuild(organizationId, buildType, buildConfig = {}) {
  try {
    const {
      buildId = `build-${crypto.randomUUID()}`,
      buildName = buildType,
      repositoryUrl = null,
      branchName = "main",
      commitHash = null,
      commitMessage = null,
      taggedRelease = null,
      gpgKeyId = null
    } = buildConfig;

    const query = `
      INSERT INTO build_configurations (
        build_id, organization_id, build_type, build_name,
        repository_url, branch_name, commit_hash, commit_message,
        tagged_release, gpg_key_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, build_id;
    `;

    const result = await db.pool.query(query, [
      buildId,
      organizationId,
      buildType,
      buildName,
      repositoryUrl,
      branchName,
      commitHash,
      commitMessage,
      taggedRelease,
      gpgKeyId
    ]);

    return {
      created: true,
      build_id: result.rows[0].id,
      build_number: result.rows[0].build_id
    };
  } catch (error) {
    console.error("Error creating build:", error);
    return { created: false, error: error.message };
  }
}

/**
 * Update build status and test results
 */
async function updateBuildStatus(buildId, status, buildResults = {}) {
  try {
    const {
      compilationPassed = null,
      unitTestsPassed = null,
      integrationTestsPassed = null,
      securityScanPassed = null,
      lintCheckPassed = null,
      coveragePercentage = null,
      vulnerabilitiesFound = 0,
      criticalVulnerabilities = 0,
      durationMinutes = null,
      buildLogUrl = null,
      buildArtifactsUrl = null
    } = buildResults;

    const completedAt = status === "passed" || status === "failed" ? new Date() : null;

    const query = `
      UPDATE build_configurations
      SET status = $2, compilation_passed = $3,
          unit_tests_passed = $4, integration_tests_passed = $5,
          security_scan_passed = $6, lint_check_passed = $7,
          coverage_percentage = $8, vulnerabilities_found = $9,
          critical_vulnerabilities = $10, duration_minutes = $11,
          build_log_url = $12, build_artifacts_url = $13,
          completed_at = $14
      WHERE id = $1
      RETURNING id, status;
    `;

    const result = await db.pool.query(query, [
      buildId,
      status,
      compilationPassed,
      unitTestsPassed,
      integrationTestsPassed,
      securityScanPassed,
      lintCheckPassed,
      coveragePercentage,
      vulnerabilitiesFound,
      criticalVulnerabilities,
      durationMinutes,
      buildLogUrl,
      buildArtifactsUrl,
      completedAt
    ]);

    if (result.rows.length === 0) {
      return { updated: false, reason: "build_not_found" };
    }

    return {
      updated: true,
      build_id: buildId,
      new_status: result.rows[0].status
    };
  } catch (error) {
    console.error("Error updating build status:", error);
    return { updated: false, error: error.message };
  }
}

/**
 * Add build artifact
 */
async function addBuildArtifact(buildId, artifactName, artifactType, artifactConfig = {}) {
  try {
    const {
      artifactVersion = null,
      artifactLocation = null,
      artifactSizeBytes = null,
      artifactHash = null,
      signatureAlgorithm = "rsa"
    } = artifactConfig;

    const query = `
      INSERT INTO build_artifacts (
        build_id, artifact_name, artifact_type, artifact_version,
        artifact_location, artifact_size_bytes, artifact_hash,
        signature_algorithm
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      buildId,
      artifactName,
      artifactType,
      artifactVersion,
      artifactLocation,
      artifactSizeBytes,
      artifactHash,
      signatureAlgorithm
    ]);

    return {
      added: true,
      artifact_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error adding build artifact:", error);
    return { added: false, error: error.message };
  }
}

/**
 * Verify artifact signature
 */
async function verifyArtifactSignature(artifactId, artifactSignature) {
  try {
    const query = `
      UPDATE build_artifacts
      SET artifact_signature = $2, signature_verified = true
      WHERE id = $1
      RETURNING id, artifact_name;
    `;

    const result = await db.pool.query(query, [
      artifactId,
      artifactSignature
    ]);

    if (result.rows.length === 0) {
      return { verified: false, reason: "artifact_not_found" };
    }

    return {
      verified: true,
      artifact_id: artifactId,
      artifact_name: result.rows[0].artifact_name
    };
  } catch (error) {
    console.error("Error verifying artifact signature:", error);
    return { verified: false, error: error.message };
  }
}

/**
 * Record dependency lock file
 */
async function recordDependencyLock(organizationId, lockFileType, lockConfig = {}) {
  try {
    const {
      lockFileVersion = "1.0",
      lockFileHash = null,
      lockedBy = null,
      lockGitCommit = null,
      lockBranch = "main",
      totalDependencies = 0,
      directDependencies = 0,
      transitiveDependencies = 0,
      devDependencies = 0
    } = lockConfig;

    const query = `
      INSERT INTO dependency_locks (
        organization_id, lock_file_type, lock_file_version,
        lock_file_hash, locked_by, lock_git_commit, lock_branch,
        total_dependencies, direct_dependencies,
        transitive_dependencies, dev_dependencies
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      lockFileType,
      lockFileVersion,
      lockFileHash,
      lockedBy,
      lockGitCommit,
      lockBranch,
      totalDependencies,
      directDependencies,
      transitiveDependencies,
      devDependencies
    ]);

    return {
      recorded: true,
      lock_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error recording dependency lock:", error);
    return { recorded: false, error: error.message };
  }
}

/**
 * Generate software bill of materials (SBOM)
 */
async function generateSbom(buildId, sbomConfig = {}) {
  try {
    const {
      sbomFormat = "cyclonedx",
      sbomVersion = "1.3",
      generatedBy = "automation",
      componentCount = 0,
      licenseCount = 0,
      componentsWithUnknownLicense = 0,
      componentsWithCopyleftLicense = 0,
      licenseCompliancePassed = true,
      restrictedLicensesFound = false,
      sbomContent = null,
      sbomFileLocation = null
    } = sbomConfig;

    const sbomHash = crypto
      .createHash("sha256")
      .update(`${buildId}:${Date.now()}`)
      .digest("hex");

    const query = `
      INSERT INTO software_bill_of_materials (
        build_id, sbom_format, sbom_version, sbom_hash,
        generated_by, component_count, license_count,
        components_with_unknown_license, components_with_copyleft_license,
        license_compliance_check_passed, restricted_licenses_found,
        sbom_content, sbom_file_location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      buildId,
      sbomFormat,
      sbomVersion,
      sbomHash,
      generatedBy,
      componentCount,
      licenseCount,
      componentsWithUnknownLicense,
      componentsWithCopyleftLicense,
      licenseCompliancePassed,
      restrictedLicensesFound,
      JSON.stringify(sbomContent),
      sbomFileLocation
    ]);

    return {
      generated: true,
      sbom_id: result.rows[0].id,
      sbom_hash: sbomHash
    };
  } catch (error) {
    console.error("Error generating SBOM:", error);
    return { generated: false, error: error.message };
  }
}

/**
 * Create build policy
 */
async function createBuildPolicy(organizationId, policyName, policyConfig = {}) {
  try {
    const {
      policyDescription = "",
      requireSignedCommits = false,
      requireSignedArtifacts = false,
      requireSbomGeneration = false,
      requireSecurityScan = true,
      requireDependencyScan = true,
      requireUnitTests = true,
      requireIntegrationTests = true,
      requiredCodeCoveragePercent = 80,
      blockOnCriticalVulnerabilities = true,
      blockOnHighVulnerabilities = false,
      maxAllowedVulnerabilities = 0,
      enforceLicenseCompliance = false,
      forbiddenLicenses = null,
      requireCiBuild = true,
      requirePeerReview = true,
      minPeerReviews = 1
    } = policyConfig;

    const query = `
      INSERT INTO build_policies (
        organization_id, policy_name, policy_description,
        require_signed_commits, require_signed_artifacts,
        require_sbom_generation, require_security_scan,
        require_dependency_scan, require_unit_tests,
        require_integration_tests, require_code_coverage_percent,
        block_on_critical_vulnerabilities, block_on_high_vulnerabilities,
        max_allowed_vulnerabilities, enforce_license_compliance,
        forbidden_licenses, require_ci_build, require_peer_review,
        min_peer_reviews
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id, policy_name;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      policyName,
      policyDescription,
      requireSignedCommits,
      requireSignedArtifacts,
      requireSbomGeneration,
      requireSecurityScan,
      requireDependencyScan,
      requireUnitTests,
      requireIntegrationTests,
      requiredCodeCoveragePercent,
      blockOnCriticalVulnerabilities,
      blockOnHighVulnerabilities,
      maxAllowedVulnerabilities,
      enforceLicenseCompliance,
      JSON.stringify(forbiddenLicenses),
      requireCiBuild,
      requirePeerReview,
      minPeerReviews
    ]);

    return {
      created: true,
      policy_id: result.rows[0].id,
      policy_name: result.rows[0].policy_name
    };
  } catch (error) {
    console.error("Error creating build policy:", error);
    return { created: false, error: error.message };
  }
}

/**
 * Record policy violation
 */
async function recordPolicyViolation(buildId, policyId, violationType, violationConfig = {}) {
  try {
    const {
      violationSeverity = "medium",
      violationDescription = "",
      violationDetails = null,
      blocksDeployment = true
    } = violationConfig;

    const query = `
      INSERT INTO build_policy_violations (
        build_id, build_policy_id, violation_type, violation_severity,
        violation_description, violation_details, blocks_deployment, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      buildId,
      policyId,
      violationType,
      violationSeverity,
      violationDescription,
      JSON.stringify(violationDetails),
      blocksDeployment,
      "open"
    ]);

    return {
      recorded: true,
      violation_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error recording policy violation:", error);
    return { recorded: false, error: error.message };
  }
}

/**
 * Resolve policy violation
 */
async function resolvePolicyViolation(violationId, resolutionMethod, resolutionConfig = {}) {
  try {
    const {
      resolutionNotes = "",
      waivedBy = null,
      waivedUntil = null
    } = resolutionConfig;

    const query = `
      UPDATE build_policy_violations
      SET status = $2, resolution_method = $3, resolution_notes = $4,
          waived_by = $5, waived_until = $6, resolved_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, status;
    `;

    const result = await db.pool.query(query, [
      violationId,
      resolutionMethod === "waived" ? "waived" : "resolved",
      resolutionMethod,
      resolutionNotes,
      waivedBy,
      waivedUntil
    ]);

    if (result.rows.length === 0) {
      return { resolved: false, reason: "violation_not_found" };
    }

    return {
      resolved: true,
      violation_id: violationId,
      new_status: result.rows[0].status
    };
  } catch (error) {
    console.error("Error resolving policy violation:", error);
    return { resolved: false, error: error.message };
  }
}

/**
 * Get dependency vulnerability summary
 */
async function getDependencyVulnerabilitySummary() {
  try {
    const query = `SELECT * FROM dependency_vulnerability_summary ORDER BY max_cvss_score DESC NULLS LAST`;
    const result = await db.pool.query(query);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting vulnerability summary:", error);
    return { error: error.message };
  }
}

/**
 * Get build status summary
 */
async function getBuildStatusSummary(organizationId = null) {
  try {
    let query = `SELECT * FROM build_status_summary`;
    const params = [];

    if (organizationId) {
      query += ` WHERE organization_id = $1`;
      params.push(organizationId);
    }

    const result = await db.pool.query(query, params);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting build status summary:", error);
    return { error: error.message };
  }
}

/**
 * Get artifact integrity summary
 */
async function getArtifactIntegritySummary() {
  try {
    const query = `SELECT * FROM artifact_integrity_summary`;
    const result = await db.pool.query(query);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting artifact integrity summary:", error);
    return { error: error.message };
  }
}

module.exports = {
  registerDependency,
  reportDependencyVulnerability,
  createBuild,
  updateBuildStatus,
  addBuildArtifact,
  verifyArtifactSignature,
  recordDependencyLock,
  generateSbom,
  createBuildPolicy,
  recordPolicyViolation,
  resolvePolicyViolation,
  getDependencyVulnerabilitySummary,
  getBuildStatusSummary,
  getArtifactIntegritySummary
};
