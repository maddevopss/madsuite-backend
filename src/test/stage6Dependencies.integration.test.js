/**
 * Issue #174 PR F: Dependencies & Build Chain Integration Tests
 *
 * Test cases for:
 * - Dependency registration and tracking
 * - Vulnerability detection and reporting
 * - Build configuration and execution
 * - Artifact integrity verification
 * - Dependency lock files
 * - SBOM generation
 * - Build policies and compliance
 * - Policy violation tracking
 */

const db = require("../../db");
const buildService = require("../services/dependenciesBuildChainService");
const crypto = require("crypto");

describe("Stage 6: Dependencies & Build Chain", () => {
  const testOrgId = "550e8400-e29b-41d4-a716-446655440004";

  beforeAll(async () => {
    try {
      await db.pool.query(
        `INSERT INTO organizations (id, name, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [testOrgId, "Build Test Org", "build-test"]
      );
    } catch (error) {
      console.log("Setup warning:", error.message);
    }
  });

  afterAll(async () => {
    try {
      await db.pool.query(`DELETE FROM build_policy_violations WHERE build_id IN (SELECT id FROM build_configurations WHERE organization_id = $1)`, [testOrgId]);
      await db.pool.query(`DELETE FROM build_artifacts WHERE build_id IN (SELECT id FROM build_configurations WHERE organization_id = $1)`, [testOrgId]);
      await db.pool.query(`DELETE FROM build_configurations WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM dependency_vulnerabilities WHERE package_dependency_id IN (SELECT id FROM package_dependencies WHERE organization_id = $1)`, [testOrgId]);
      await db.pool.query(`DELETE FROM package_dependencies WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM build_policies WHERE organization_id = $1`, [testOrgId]);
    } catch (error) {
      console.log("Cleanup warning:", error.message);
    }
  });

  describe("Dependency Management", () => {
    test("Register npm dependency", async () => {
      const result = await buildService.registerDependency(
        "express",
        "4.18.2",
        "npm",
        {
          registrySource: "npm",
          environment: "production"
        }
      );

      expect(result.registered).toBe(true);
      expect(result.package_name).toBe("express");
    });

    test("Register dev dependency", async () => {
      const result = await buildService.registerDependency(
        "jest",
        "29.5.0",
        "npm",
        {
          isDevDependency: true,
          environment: "test"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register transitive dependency", async () => {
      const result = await buildService.registerDependency(
        "lodash",
        "4.17.21",
        "npm",
        {
          dependencyType: "transitive"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register Python dependency", async () => {
      const result = await buildService.registerDependency(
        "requests",
        "2.31.0",
        "pip",
        { registrySource: "pypi" }
      );

      expect(result.registered).toBe(true);
    });

    test("Register multiple dependencies for same package", async () => {
      const versions = ["1.0.0", "2.0.0", "3.0.0"];

      for (const version of versions) {
        const result = await buildService.registerDependency(
          "react",
          version,
          "npm"
        );
        expect(result.registered).toBe(true);
      }
    });
  });

  describe("Vulnerability Management", () => {
    test("Report critical vulnerability", async () => {
      const dep = await buildService.registerDependency("lodash", "4.17.20", "npm");

      const result = await buildService.reportDependencyVulnerability(
        dep.dependency_id,
        "CVE-2021-23337",
        {
          severityLevel: "critical",
          cvssScore: 9.8,
          description: "Arbitrary code execution in lodash",
          affectedVersions: "<4.17.21",
          patchedVersions: ">=4.17.21"
        }
      );

      expect(result.reported).toBe(true);
    });

    test("Report high severity vulnerability", async () => {
      const dep = await buildService.registerDependency("express", "4.17.0", "npm");

      const result = await buildService.reportDependencyVulnerability(
        dep.dependency_id,
        "CVE-2023-12345",
        {
          severityLevel: "high",
          cvssScore: 7.5,
          cveReference: "CVE-2023-12345",
          advisoryUrl: "https://github.com/advisories/CVE-2023-12345"
        }
      );

      expect(result.reported).toBe(true);
    });

    test("Report medium vulnerability", async () => {
      const dep = await buildService.registerDependency("axios", "1.0.0", "npm");

      const result = await buildService.reportDependencyVulnerability(
        dep.dependency_id,
        "GHSA-1234-5678-9012",
        { severityLevel: "medium", cvssScore: 5.3 }
      );

      expect(result.reported).toBe(true);
    });

    test("Report low severity vulnerability", async () => {
      const dep = await buildService.registerDependency("moment", "2.29.0", "npm");

      const result = await buildService.reportDependencyVulnerability(
        dep.dependency_id,
        "GHSA-xxxx-yyyy-zzzz",
        { severityLevel: "low", cvssScore: 3.1 }
      );

      expect(result.reported).toBe(true);
    });

    test("Get vulnerability summary", async () => {
      const result = await buildService.getDependencyVulnerabilitySummary();

      expect(Array.isArray(result.summary)).toBe(true);
    });
  });

  describe("Build Configuration", () => {
    test("Create CI build", async () => {
      const result = await buildService.createBuild(
        testOrgId,
        "ci",
        {
          buildName: "CI Build #123",
          repositoryUrl: "https://github.com/example/repo",
          branchName: "main",
          commitHash: "abc123def456"
        }
      );

      expect(result.created).toBe(true);
      expect(result.build_id).toBeDefined();
    });

    test("Create release build", async () => {
      const result = await buildService.createBuild(
        testOrgId,
        "release",
        {
          buildName: "Release Build v1.0.0",
          taggedRelease: "v1.0.0",
          commitHash: "def456ghi789"
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create hotfix build", async () => {
      const result = await buildService.createBuild(
        testOrgId,
        "hotfix",
        { buildName: "Hotfix Build" }
      );

      expect(result.created).toBe(true);
    });

    test("Create nightly build", async () => {
      const result = await buildService.createBuild(
        testOrgId,
        "nightly",
        { buildName: "Nightly Build" }
      );

      expect(result.created).toBe(true);
    });

    test("Update build status to passed", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.updateBuildStatus(
        build.build_id,
        "passed",
        {
          compilationPassed: true,
          unitTestsPassed: true,
          integrationTestsPassed: true,
          securityScanPassed: true,
          lintCheckPassed: true,
          coveragePercentage: 85.5,
          durationMinutes: 12
        }
      );

      expect(result.updated).toBe(true);
    });

    test("Update build status to failed", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.updateBuildStatus(
        build.build_id,
        "failed",
        {
          compilationPassed: false,
          unitTestsPassed: false,
          durationMinutes: 5
        }
      );

      expect(result.updated).toBe(true);
    });

    test("Update build with vulnerability findings", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.updateBuildStatus(
        build.build_id,
        "passed",
        {
          vulnerabilitiesFound: 3,
          criticalVulnerabilities: 1,
          securityScanPassed: false
        }
      );

      expect(result.updated).toBe(true);
    });

    test("Get build status summary", async () => {
      const result = await buildService.getBuildStatusSummary(testOrgId);

      expect(Array.isArray(result.summary)).toBe(true);
    });
  });

  describe("Build Artifacts", () => {
    test("Add Docker image artifact", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.addBuildArtifact(
        build.build_id,
        "myapp:1.0.0",
        "docker_image",
        {
          artifactLocation: "docker.io/myapp:1.0.0",
          artifactHash: "sha256:abcdef123456"
        }
      );

      expect(result.added).toBe(true);
    });

    test("Add JAR artifact", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.addBuildArtifact(
        build.build_id,
        "app.jar",
        "jar",
        {
          artifactVersion: "1.0.0",
          artifactSizeBytes: 50000000,
          artifactHash: "sha256:fedcba654321"
        }
      );

      expect(result.added).toBe(true);
    });

    test("Add npm package artifact", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.addBuildArtifact(
        build.build_id,
        "mypackage-1.0.0.tgz",
        "npm_package",
        { artifactVersion: "1.0.0" }
      );

      expect(result.added).toBe(true);
    });

    test("Add binary artifact", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.addBuildArtifact(
        build.build_id,
        "myapp-linux-x64",
        "binary",
        { artifactSizeBytes: 100000000 }
      );

      expect(result.added).toBe(true);
    });

    test("Verify artifact signature", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");
      const artifact = await buildService.addBuildArtifact(
        build.build_id,
        "test-artifact",
        "binary"
      );

      const result = await buildService.verifyArtifactSignature(
        artifact.artifact_id,
        "signature_data_here"
      );

      expect(result.verified).toBe(true);
    });

    test("Get artifact integrity summary", async () => {
      const result = await buildService.getArtifactIntegritySummary();

      expect(Array.isArray(result.summary)).toBe(true);
    });
  });

  describe("Dependency Locking", () => {
    test("Record package-lock.json", async () => {
      const result = await buildService.recordDependencyLock(
        testOrgId,
        "package-lock.json",
        {
          lockFileVersion: "2",
          totalDependencies: 150,
          directDependencies: 25,
          transitiveDependencies: 125,
          devDependencies: 15
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Record yarn.lock", async () => {
      const result = await buildService.recordDependencyLock(
        testOrgId,
        "yarn.lock",
        {
          lockFileVersion: "1.22.0",
          totalDependencies: 200
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Record Pipfile.lock", async () => {
      const result = await buildService.recordDependencyLock(
        testOrgId,
        "Pipfile.lock",
        {
          lockFileVersion: "11001",
          totalDependencies: 50
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Record Gemfile.lock", async () => {
      const result = await buildService.recordDependencyLock(
        testOrgId,
        "Gemfile.lock",
        {
          lockFileVersion: "2",
          totalDependencies: 75
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Record Cargo.lock", async () => {
      const result = await buildService.recordDependencyLock(
        testOrgId,
        "Cargo.lock",
        { totalDependencies: 100 }
      );

      expect(result.recorded).toBe(true);
    });
  });

  describe("SBOM Generation", () => {
    test("Generate CycloneDX SBOM", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.generateSbom(
        build.build_id,
        {
          sbomFormat: "cyclonedx",
          sbomVersion: "1.3",
          componentCount: 150,
          licenseCount: 25,
          licenseCompliancePassed: true
        }
      );

      expect(result.generated).toBe(true);
      expect(result.sbom_hash).toBeDefined();
    });

    test("Generate SPDX SBOM", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.generateSbom(
        build.build_id,
        {
          sbomFormat: "spdx",
          sbomVersion: "2.3"
        }
      );

      expect(result.generated).toBe(true);
    });

    test("Generate SBOM with restricted licenses", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.generateSbom(
        build.build_id,
        {
          licenseCompliancePassed: false,
          restrictedLicensesFound: true
        }
      );

      expect(result.generated).toBe(true);
    });

    test("Generate SBOM with unknown licenses", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const result = await buildService.generateSbom(
        build.build_id,
        {
          licenseCount: 25,
          componentsWithUnknownLicense: 5
        }
      );

      expect(result.generated).toBe(true);
    });
  });

  describe("Build Policies", () => {
    test("Create basic build policy", async () => {
      const result = await buildService.createBuildPolicy(
        testOrgId,
        "Standard Policy",
        {
          requireSecurityScan: true,
          requireUnitTests: true,
          requiredCodeCoveragePercent: 80
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create strict build policy", async () => {
      const result = await buildService.createBuildPolicy(
        testOrgId,
        "Strict Policy",
        {
          requireSignedCommits: true,
          requireSignedArtifacts: true,
          requireSbomGeneration: true,
          blockOnCriticalVulnerabilities: true,
          blockOnHighVulnerabilities: true,
          maxAllowedVulnerabilities: 0
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create policy with license enforcement", async () => {
      const result = await buildService.createBuildPolicy(
        testOrgId,
        "License Policy",
        {
          enforceLicenseCompliance: true,
          forbiddenLicenses: ["GPL-3.0", "AGPL-3.0"]
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create policy with peer review requirement", async () => {
      const result = await buildService.createBuildPolicy(
        testOrgId,
        "Review Policy",
        {
          requirePeerReview: true,
          minPeerReviews: 2,
          requireCiBuild: true
        }
      );

      expect(result.created).toBe(true);
    });
  });

  describe("Policy Violations", () => {
    test("Record security scan failure violation", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");
      const policy = await buildService.createBuildPolicy(testOrgId, "Test Policy");

      const result = await buildService.recordPolicyViolation(
        build.build_id,
        policy.policy_id,
        "security_scan_failed",
        {
          violationSeverity: "high",
          violationDescription: "Security scan did not pass",
          blocksDeployment: true
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Record vulnerability found violation", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");
      const policy = await buildService.createBuildPolicy(testOrgId, "Vuln Policy");

      const result = await buildService.recordPolicyViolation(
        build.build_id,
        policy.policy_id,
        "vulnerability_found",
        {
          violationSeverity: "critical",
          violationDetails: { cve: "CVE-2023-12345" }
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Record coverage below threshold violation", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");
      const policy = await buildService.createBuildPolicy(testOrgId, "Coverage Policy");

      const result = await buildService.recordPolicyViolation(
        build.build_id,
        policy.policy_id,
        "coverage_below_threshold",
        {
          violationDetails: { coverage: 75, required: 80 }
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Resolve violation by fixing", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");
      const policy = await buildService.createBuildPolicy(testOrgId, "Policy");
      const violation = await buildService.recordPolicyViolation(
        build.build_id,
        policy.policy_id,
        "test_failure"
      );

      const result = await buildService.resolvePolicyViolation(
        violation.violation_id,
        "fixed",
        { resolutionNotes: "Fixed failing tests" }
      );

      expect(result.resolved).toBe(true);
    });

    test("Resolve violation by waiver", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");
      const policy = await buildService.createBuildPolicy(testOrgId, "Policy");
      const violation = await buildService.recordPolicyViolation(
        build.build_id,
        policy.policy_id,
        "low_priority_issue"
      );

      const waivedUntil = new Date();
      waivedUntil.setDate(waivedUntil.getDate() + 7);

      const result = await buildService.resolvePolicyViolation(
        violation.violation_id,
        "waived",
        {
          waivedBy: "admin@example.com",
          waivedUntil: waivedUntil,
          resolutionNotes: "Waived for 7 days"
        }
      );

      expect(result.resolved).toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    test("Complete build pipeline: register dependencies -> create build -> scan -> generate SBOM", async () => {
      // Register dependencies
      const dep1 = await buildService.registerDependency("express", "4.18.0", "npm");
      const dep2 = await buildService.registerDependency("lodash", "4.17.20", "npm");

      // Create build
      const build = await buildService.createBuild(testOrgId, "ci");

      // Update build status with security scan
      await buildService.updateBuildStatus(build.build_id, "passed", {
        securityScanPassed: true,
        vulnerabilitiesFound: 0
      });

      // Generate SBOM
      const sbom = await buildService.generateSbom(build.build_id);

      // Add artifact
      const artifact = await buildService.addBuildArtifact(
        build.build_id,
        "app:1.0.0",
        "docker_image"
      );

      expect(dep1.registered).toBe(true);
      expect(build.created).toBe(true);
      expect(sbom.generated).toBe(true);
      expect(artifact.added).toBe(true);
    });

    test("Vulnerability detection and tracking workflow", async () => {
      // Register dependency
      const dep = await buildService.registerDependency("lodash", "4.17.20", "npm");

      // Report vulnerability
      const vuln = await buildService.reportDependencyVulnerability(
        dep.dependency_id,
        "CVE-2021-23337",
        { severityLevel: "critical", cvssScore: 9.8 }
      );

      // Get summary
      const summary = await buildService.getDependencyVulnerabilitySummary();

      expect(dep.registered).toBe(true);
      expect(vuln.reported).toBe(true);
      expect(Array.isArray(summary.summary)).toBe(true);
    });

    test("Policy compliance workflow", async () => {
      // Create policy
      const policy = await buildService.createBuildPolicy(
        testOrgId,
        "Compliance Policy",
        {
          requireSecurityScan: true,
          blockOnCriticalVulnerabilities: true
        }
      );

      // Create build
      const build = await buildService.createBuild(testOrgId, "ci");

      // Record violation
      const violation = await buildService.recordPolicyViolation(
        build.build_id,
        policy.policy_id,
        "security_scan_failed"
      );

      // Resolve violation
      const resolved = await buildService.resolvePolicyViolation(
        violation.violation_id,
        "fixed"
      );

      expect(policy.created).toBe(true);
      expect(violation.recorded).toBe(true);
      expect(resolved.resolved).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("Register multiple versions of same dependency", async () => {
      const versions = ["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0"];

      for (const version of versions) {
        const result = await buildService.registerDependency(
          "multi-version-lib",
          version,
          "npm"
        );
        expect(result.registered).toBe(true);
      }
    });

    test("Report multiple vulnerabilities for same dependency", async () => {
      const dep = await buildService.registerDependency("vuln-lib", "1.0.0", "npm");

      const vulns = ["CVE-001", "CVE-002", "CVE-003"];

      for (const cve of vulns) {
        const result = await buildService.reportDependencyVulnerability(
          dep.dependency_id,
          cve
        );
        expect(result.reported).toBe(true);
      }
    });

    test("Create multiple builds in sequence", async () => {
      const buildTypes = ["ci", "release", "hotfix", "nightly"];

      for (const type of buildTypes) {
        const result = await buildService.createBuild(testOrgId, type);
        expect(result.created).toBe(true);
      }
    });

    test("Add multiple artifacts to single build", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const artifactTypes = ["docker_image", "jar", "npm_package", "binary"];

      for (const type of artifactTypes) {
        const result = await buildService.addBuildArtifact(
          build.build_id,
          `artifact-${type}`,
          type
        );
        expect(result.added).toBe(true);
      }
    });

    test("Handle rapid build creation", async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          buildService.createBuild(testOrgId, "ci", {
            buildName: `Build ${i}`
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results.every(r => r.created === true)).toBe(true);
    });
  });

  describe("Security and Compliance", () => {
    test("Track signed commits", async () => {
      const result = await buildService.createBuild(
        testOrgId,
        "ci",
        { gpgKeyId: "0x12345678" }
      );

      expect(result.created).toBe(true);
    });

    test("Verify multiple artifacts", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      for (let i = 0; i < 3; i++) {
        const artifact = await buildService.addBuildArtifact(
          build.build_id,
          `artifact-${i}`,
          "binary"
        );

        const verified = await buildService.verifyArtifactSignature(
          artifact.artifact_id,
          `signature-${i}`
        );

        expect(verified.verified).toBe(true);
      }
    });

    test("License compliance tracking", async () => {
      const build = await buildService.createBuild(testOrgId, "ci");

      const sbom = await buildService.generateSbom(build.build_id, {
        licenseCompliancePassed: false,
        restrictedLicensesFound: true,
        componentCount: 100
      });

      expect(sbom.generated).toBe(true);
    });
  });
});
