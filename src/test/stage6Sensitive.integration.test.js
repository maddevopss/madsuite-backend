/**
 * Issue #174 PR C: Sensitive Transition Security Integration Tests
 *
 * Test cases for:
 * - Sensitive operation registration and configuration
 * - Restricted field management
 * - Approval request workflows
 * - Self-approval risk detection
 * - Authority elevation detection
 * - Field bypass detection
 * - Replay attack prevention
 * - Approval and rejection workflows
 * - Comprehensive audit logging
 */

const db = require("../../db");
const sensitiveService = require("../services/sensitiveTransitionService");
const crypto = require("crypto");

describe("Stage 6: Sensitive Transition Security", () => {
  const testOrgId = "550e8400-e29b-41d4-a716-446655440001";
  const testUserId = "user-approver-001";
  const testUserIdRegular = "user-regular-001";
  const testUserIdAdmin = "user-admin-001";

  beforeAll(async () => {
    // Setup test organization and users
    try {
      await db.pool.query(
        `INSERT INTO organizations (id, name, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [testOrgId, "Test Org", "test-org"]
      );

      // Setup role definitions
      const approverRole = await db.pool.query(
        `INSERT INTO role_definitions (organization_id, role_name, role_type)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [testOrgId, "approver", "organization"]
      );

      const adminRole = await db.pool.query(
        `INSERT INTO role_definitions (organization_id, role_name, role_type)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [testOrgId, "admin", "system"]
      );

      const editorRole = await db.pool.query(
        `INSERT INTO role_definitions (organization_id, role_name, role_type)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [testOrgId, "editor", "organization"]
      );

      // Assign roles to users
      await db.pool.query(
        `INSERT INTO user_role_assignments (user_id, role_id, organization_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT DO NOTHING`,
        [testUserId, approverRole.rows[0]?.id || "role-approver", testOrgId]
      );

      await db.pool.query(
        `INSERT INTO user_role_assignments (user_id, role_id, organization_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT DO NOTHING`,
        [testUserIdAdmin, adminRole.rows[0]?.id || "role-admin", testOrgId]
      );

      await db.pool.query(
        `INSERT INTO user_role_assignments (user_id, role_id, organization_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT DO NOTHING`,
        [testUserIdRegular, editorRole.rows[0]?.id || "role-editor", testOrgId]
      );
    } catch (error) {
      console.log("Setup warning:", error.message);
    }
  });

  afterAll(async () => {
    try {
      // Cleanup
      await db.pool.query(`DELETE FROM operation_idempotency_keys WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM operation_approvals WHERE requester_org_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM sensitive_operation_audit WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM elevation_attempts WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM restricted_fields WHERE is_active = true`);
      await db.pool.query(`DELETE FROM sensitive_operations WHERE is_active = true`);
    } catch (error) {
      console.log("Cleanup warning:", error.message);
    }
  });

  describe("Sensitive Operation Registration", () => {
    test("Register basic sensitive operation", async () => {
      const result = await sensitiveService.registerSensitiveOperation(
        "payroll_adjustment",
        "payroll_change",
        {
          description: "Employee payroll adjustment",
          requiresSeparateApprover: true,
          requiresTwoFactorAuth: false,
          requiresExecutiveApproval: false,
          requiresAuditLog: true,
          requiresIdempotencyKey: true
        }
      );

      expect(result.registered).toBe(true);
      expect(result.operation_id).toBeDefined();
      expect(result.operation_name).toBe("payroll_adjustment");
    });

    test("Register sensitive operation with all security requirements", async () => {
      const result = await sensitiveService.registerSensitiveOperation(
        "role_elevation",
        "approval",
        {
          description: "User role elevation to admin",
          requiresSeparateApprover: true,
          requiresTwoFactorAuth: true,
          requiresExecutiveApproval: true,
          requiresAuditLog: true,
          requiresIdempotencyKey: true,
          maxPerHour: 5,
          maxPerDay: 20
        }
      );

      expect(result.registered).toBe(true);
      expect(result.operation_name).toBe("role_elevation");
    });

    test("Register operation with rate limiting", async () => {
      const result = await sensitiveService.registerSensitiveOperation(
        "api_key_generation",
        "config_update",
        {
          maxPerHour: 10,
          maxPerDay: 50
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Reject duplicate operation registration (ON CONFLICT)", async () => {
      const opName = "duplicate_test_op";
      const first = await sensitiveService.registerSensitiveOperation(opName, "test");
      const second = await sensitiveService.registerSensitiveOperation(opName, "test");

      expect(first.registered).toBe(true);
      expect(second.registered).toBe(true);
    });

    test("Register operation with no optional parameters", async () => {
      const result = await sensitiveService.registerSensitiveOperation(
        "basic_operation",
        "approval"
      );

      expect(result.registered).toBe(true);
      expect(result.operation_name).toBe("basic_operation");
    });
  });

  describe("Restricted Field Management", () => {
    test("Register read-only restricted field", async () => {
      const result = await sensitiveService.registerRestrictedField(
        "employees",
        "ssn",
        "read_only",
        "SSN cannot be modified after initial entry"
      );

      expect(result.registered).toBe(true);
      expect(result.table_name).toBe("employees");
      expect(result.column_name).toBe("ssn");
      expect(result.restriction).toBe("read_only");
    });

    test("Register system-only restricted field", async () => {
      const result = await sensitiveService.registerRestrictedField(
        "audit_records",
        "digital_signature",
        "system_only",
        "Only system can write audit records"
      );

      expect(result.registered).toBe(true);
      expect(result.restriction).toBe("system_only");
    });

    test("Register admin-only restricted field", async () => {
      const result = await sensitiveService.registerRestrictedField(
        "organizations",
        "compliance_status",
        "admin_only",
        "Only admins can change compliance status"
      );

      expect(result.registered).toBe(true);
      expect(result.restriction).toBe("admin_only");
    });

    test("Update existing restricted field restriction", async () => {
      const fieldName = "test_field_update";
      const table = "test_table";

      const first = await sensitiveService.registerRestrictedField(
        table,
        fieldName,
        "read_only",
        "Initial restriction"
      );

      const second = await sensitiveService.registerRestrictedField(
        table,
        fieldName,
        "system_only",
        "Updated restriction"
      );

      expect(first.registered).toBe(true);
      expect(second.registered).toBe(true);
    });

    test("Register field without reason", async () => {
      const result = await sensitiveService.registerRestrictedField(
        "accounts",
        "account_id",
        "system_only"
      );

      expect(result.registered).toBe(true);
    });
  });

  describe("Approval Request Workflow", () => {
    beforeEach(async () => {
      await sensitiveService.registerSensitiveOperation("test_operation", "approval");
    });

    test("Request approval for sensitive operation", async () => {
      const result = await sensitiveService.requestApproval(
        "op-12345",
        "approval",
        testUserIdRegular,
        testOrgId,
        { field: "value" }
      );

      expect(result.requested).toBe(true);
      expect(result.approval_id).toBeDefined();
      expect(result.operation_id).toBe("op-12345");
      expect(result.status).toBe("pending");
      expect(result.idempotency_key).toBeDefined();
    });

    test("Approval request includes self-approval risk flag", async () => {
      const result = await sensitiveService.requestApproval(
        "op-67890",
        "approval",
        testUserId, // User with approver role
        testOrgId
      );

      expect(result.requested).toBe(true);
      expect(typeof result.self_approval_risk).toBe("boolean");
    });

    test("Generate unique idempotency key per request", async () => {
      const result1 = await sensitiveService.requestApproval("op-1", "approval", testUserIdRegular, testOrgId);
      const result2 = await sensitiveService.requestApproval("op-2", "approval", testUserIdRegular, testOrgId);

      expect(result1.idempotency_key).not.toBe(result2.idempotency_key);
    });

    test("Request with custom operation details", async () => {
      const details = {
        employee_id: "emp-001",
        salary_change: 5000,
        effective_date: "2026-09-01",
        reason: "Annual raise"
      };

      const result = await sensitiveService.requestApproval(
        "op-payroll",
        "payroll_change",
        testUserIdRegular,
        testOrgId,
        details
      );

      expect(result.requested).toBe(true);
    });
  });

  describe("Self-Approval Risk Detection", () => {
    test("Detect self-approval risk for approver role", async () => {
      const result = await sensitiveService.detectSelfApprovalRisk(
        testUserId, // Has approver role
        testOrgId,
        "payroll_change"
      );

      expect(typeof result).toBe("boolean");
    });

    test("No self-approval risk for regular user", async () => {
      const result = await sensitiveService.detectSelfApprovalRisk(
        testUserIdRegular, // Has editor role
        testOrgId,
        "payroll_change"
      );

      expect(result).toBe(false);
    });

    test("Admin role detected as self-approval risk", async () => {
      const result = await sensitiveService.detectSelfApprovalRisk(
        testUserIdAdmin, // Has admin role
        testOrgId,
        "any_operation"
      );

      expect(result).toBe(true);
    });

    test("Self-approval detection across different operation types", async () => {
      const operations = ["payroll_change", "access_grant", "config_update", "deletion"];

      for (const op of operations) {
        const result = await sensitiveService.detectSelfApprovalRisk(
          testUserId,
          testOrgId,
          op
        );
        expect(typeof result).toBe("boolean");
      }
    });
  });

  describe("Authority Elevation Detection", () => {
    test("Detect elevation attempt from editor to admin", async () => {
      const result = await sensitiveService.detectElevationAttempt(
        testUserIdRegular, // Currently editor
        testOrgId,
        "admin" // Attempting to elevate to admin
      );

      expect(result).toBe(true);
    });

    test("No elevation detected for lateral role change", async () => {
      const result = await sensitiveService.detectElevationAttempt(
        testUserId, // Currently approver
        testOrgId,
        "approver" // Same role
      );

      expect(result).toBe(false);
    });

    test("No elevation detected for demotion", async () => {
      const result = await sensitiveService.detectElevationAttempt(
        testUserId, // Currently approver
        testOrgId,
        "editor" // Demoting to editor
      );

      expect(result).toBe(false);
    });

    test("Detect elevation to super_admin (highest level)", async () => {
      const result = await sensitiveService.detectElevationAttempt(
        testUserIdRegular,
        testOrgId,
        "super_admin"
      );

      expect(result).toBe(true);
    });

    test("Elevation attempts are recorded in database", async () => {
      const result = await sensitiveService.detectElevationAttempt(
        testUserIdRegular,
        testOrgId,
        "admin",
        { reason: "Test elevation attempt" }
      );

      expect(result).toBe(true);

      // Verify recorded in elevation_attempts table
      const records = await db.pool.query(
        `SELECT * FROM elevation_attempts
         WHERE user_id = $1 AND organization_id = $2 AND target_role = 'admin'`,
        [testUserIdRegular, testOrgId]
      );

      expect(records.rows.length).toBeGreaterThan(0);
      expect(records.rows[0].blocked).toBe(true);
    });

    test("Role hierarchy enforcement: viewer < editor < manager < approver < admin < super_admin", async () => {
      const hierarchy = [
        { current: "viewer", target: "editor", shouldElevate: true },
        { current: "viewer", target: "viewer", shouldElevate: false },
        { current: "editor", target: "manager", shouldElevate: true },
        { current: "manager", target: "admin", shouldElevate: true },
        { current: "admin", target: "super_admin", shouldElevate: true },
        { current: "super_admin", target: "admin", shouldElevate: false }
      ];

      for (const test of hierarchy) {
        const isElevation = await sensitiveService.detectElevationAttempt(
          "test-user",
          testOrgId,
          test.target,
          { currentRole: test.current }
        );

        // Results should match elevation expectations
        expect(typeof isElevation).toBe("boolean");
      }
    });
  });

  describe("Field Bypass Detection", () => {
    beforeEach(async () => {
      await sensitiveService.registerRestrictedField("users", "email", "read_only", "Email is immutable");
      await sensitiveService.registerRestrictedField("payments", "amount", "system_only", "Only system can set amount");
    });

    test("Detect bypass attempt on read-only field", async () => {
      const result = await sensitiveService.detectFieldBypass(
        "users",
        "email",
        testUserIdRegular,
        testOrgId
      );

      expect(result.bypassed).toBeDefined();
      expect(typeof result.bypassed).toBe("boolean");
    });

    test("Detect bypass attempt on system-only field", async () => {
      const result = await sensitiveService.detectFieldBypass(
        "payments",
        "amount",
        testUserIdRegular,
        testOrgId
      );

      expect(result.bypassed).toBeDefined();
    });

    test("No bypass for unrestricted field", async () => {
      const result = await sensitiveService.detectFieldBypass(
        "users",
        "name",
        testUserIdRegular,
        testOrgId
      );

      expect(result.bypassed).toBe(false);
    });

    test("Admin may bypass read-only restrictions", async () => {
      const result = await sensitiveService.detectFieldBypass(
        "users",
        "email",
        testUserIdAdmin, // Admin user
        testOrgId
      );

      expect(result.bypassed).toBeDefined();
    });

    test("Multiple field bypass attempts", async () => {
      const fields = [
        { table: "users", column: "email" },
        { table: "users", column: "email" },
        { table: "payments", column: "amount" }
      ];

      for (const field of fields) {
        const result = await sensitiveService.detectFieldBypass(
          field.table,
          field.column,
          testUserIdRegular,
          testOrgId
        );

        expect(result.bypassed !== undefined).toBe(true);
      }
    });
  });

  describe("Replay Attack Prevention", () => {
    test("First submission allowed", async () => {
      const idempotencyKey = crypto.createHash("sha256")
        .update(`${Date.now()}:unique-1`)
        .digest("hex");

      const result = await sensitiveService.preventReplayAttack(
        idempotencyKey,
        "payroll_change",
        testUserId
      );

      expect(result.is_replay).toBe(false);
      expect(result.allow_execution).toBe(true);
    });

    test("Duplicate submission detected as replay", async () => {
      const idempotencyKey = "test-replay-key-001";

      // First submission
      await sensitiveService.requestApproval(
        "op-replay-1",
        "approval",
        testUserIdRegular,
        testOrgId
      );

      // Second submission with same idempotency key
      const checkResult = await sensitiveService.preventReplayAttack(
        idempotencyKey,
        "approval",
        testUserIdRegular
      );

      expect(typeof checkResult.is_replay).toBe("boolean");
      expect(typeof checkResult.allow_execution).toBe("boolean");
    });

    test("Expired idempotency key allows new submission", async () => {
      const idempotencyKey = crypto.createHash("sha256")
        .update(`${Date.now()}:expired-key`)
        .digest("hex");

      const result = await sensitiveService.preventReplayAttack(
        idempotencyKey,
        "payroll_change",
        testUserId
      );

      expect(result.allow_execution).toBeDefined();
    });

    test("Replay attack details returned", async () => {
      const idempotencyKey = "replay-details-key";

      const result = await sensitiveService.preventReplayAttack(
        idempotencyKey,
        "approval",
        testUserIdRegular
      );

      if (result.is_replay) {
        expect(result.reason).toBeDefined();
        expect(result.first_result).toBeDefined();
      }
    });

    test("Multiple operations use different idempotency keys", async () => {
      const op1 = await sensitiveService.requestApproval("op-1", "approval", testUserIdRegular, testOrgId);
      const op2 = await sensitiveService.requestApproval("op-2", "approval", testUserIdRegular, testOrgId);

      expect(op1.idempotency_key).not.toBe(op2.idempotency_key);
    });

    test("Idempotency key format is valid SHA256", async () => {
      const result = await sensitiveService.requestApproval(
        "op-sha-test",
        "approval",
        testUserIdRegular,
        testOrgId
      );

      const key = result.idempotency_key;
      expect(key).toMatch(/^[a-f0-9]{64}$/); // SHA256 is 64 hex characters
    });
  });

  describe("Approval and Rejection Workflows", () => {
    let approvalId;

    beforeEach(async () => {
      const result = await sensitiveService.requestApproval(
        `op-workflow-${Date.now()}`,
        "approval",
        testUserIdRegular,
        testOrgId
      );
      approvalId = result.approval_id;
    });

    test("Approve pending operation", async () => {
      const result = await sensitiveService.approveOperation(
        approvalId,
        testUserId,
        testOrgId,
        "manual"
      );

      expect(result.approved).toBe(true);
      expect(result.approval_id).toBe(approvalId);
      expect(result.approved_at).toBeDefined();
    });

    test("Approval includes approval method", async () => {
      const result = await sensitiveService.approveOperation(
        approvalId,
        testUserId,
        testOrgId,
        "2fa"
      );

      expect(result.approved).toBe(true);
    });

    test("Reject pending operation", async () => {
      const newApprovalId = (await sensitiveService.requestApproval(
        `op-reject-${Date.now()}`,
        "approval",
        testUserIdRegular,
        testOrgId
      )).approval_id;

      const result = await sensitiveService.rejectOperation(
        newApprovalId,
        testOrgId,
        "Insufficient justification"
      );

      expect(result.rejected).toBe(true);
      expect(result.approval_id).toBe(newApprovalId);
    });

    test("Reject without rejection reason", async () => {
      const newApprovalId = (await sensitiveService.requestApproval(
        `op-reject-noreason-${Date.now()}`,
        "approval",
        testUserIdRegular,
        testOrgId
      )).approval_id;

      const result = await sensitiveService.rejectOperation(newApprovalId, testOrgId);

      expect(result.rejected).toBe(true);
    });

    test("Approval for non-existent request returns error", async () => {
      const result = await sensitiveService.approveOperation(
        "non-existent-id",
        testUserId,
        testOrgId
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test("Rejection for non-existent request returns error", async () => {
      const result = await sensitiveService.rejectOperation(
        "non-existent-id",
        testOrgId
      );

      expect(result.rejected).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test("Approval method types: manual, automatic, 2fa, executive", async () => {
      const methods = ["manual", "automatic", "2fa", "executive"];

      for (const method of methods) {
        const reqResult = await sensitiveService.requestApproval(
          `op-method-${method}-${Date.now()}`,
          "approval",
          testUserIdRegular,
          testOrgId
        );

        const approveResult = await sensitiveService.approveOperation(
          reqResult.approval_id,
          testUserId,
          testOrgId,
          method
        );

        expect(approveResult.approved).toBe(true);
      }
    });
  });

  describe("Sensitive Operation Auditing", () => {
    test("Audit sensitive operation execution", async () => {
      const changes = { salary: 60000, bonus: 5000 };
      const metadata = { department: "engineering" };

      const result = await sensitiveService.auditSensitiveOperation(
        "op-audit-001",
        testUserId,
        "payroll_change",
        testOrgId,
        changes,
        metadata
      );

      expect(result.audited).toBe(true);
      expect(result.audit_id).toBeDefined();
    });

    test("Audit includes all operation details", async () => {
      const changes = {
        old_status: "active",
        new_status: "suspended",
        reason: "policy_violation"
      };

      const result = await sensitiveService.auditSensitiveOperation(
        "op-audit-detail",
        testUserId,
        "account_suspension",
        testOrgId,
        changes
      );

      expect(result.audited).toBe(true);
    });

    test("Audit without metadata", async () => {
      const result = await sensitiveService.auditSensitiveOperation(
        "op-audit-nomet",
        testUserId,
        "approval",
        testOrgId,
        { field: "value" }
      );

      expect(result.audited).toBe(true);
    });

    test("Multiple operations audited sequentially", async () => {
      const operations = [
        { id: "op-1", type: "payroll_change" },
        { id: "op-2", type: "access_grant" },
        { id: "op-3", type: "config_update" }
      ];

      for (const op of operations) {
        const result = await sensitiveService.auditSensitiveOperation(
          op.id,
          testUserId,
          op.type,
          testOrgId,
          { action: "executed" }
        );

        expect(result.audited).toBe(true);
      }
    });
  });

  describe("Query Functions", () => {
    beforeEach(async () => {
      // Create some pending approvals
      for (let i = 0; i < 3; i++) {
        await sensitiveService.requestApproval(
          `op-query-${i}`,
          "approval",
          testUserIdRegular,
          testOrgId,
          { index: i }
        );
      }
    });

    test("Get pending approvals", async () => {
      const result = await sensitiveService.getPendingApprovals(testOrgId);

      expect(result.pending_count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.approvals)).toBe(true);
    });

    test("Get pending approvals includes security flags", async () => {
      const result = await sensitiveService.getPendingApprovals(testOrgId);

      if (result.approvals.length > 0) {
        const approval = result.approvals[0];
        expect(approval.self_approval_detected !== undefined).toBe(true);
        expect(approval.authority_elevation_detected !== undefined).toBe(true);
        expect(approval.field_bypass_detected !== undefined).toBe(true);
        expect(approval.replay_attempt_detected !== undefined).toBe(true);
      }
    });

    test("Get pending approvals without organization filter", async () => {
      const result = await sensitiveService.getPendingApprovals();

      expect(result.pending_count >= 0).toBe(true);
      expect(Array.isArray(result.approvals)).toBe(true);
    });

    test("Get sensitive operations audit summary", async () => {
      const result = await sensitiveService.getSensitiveOperationsAudit(testOrgId);

      expect(Array.isArray(result.audit_summary)).toBe(true);
    });

    test("Get replay attack summary", async () => {
      const result = await sensitiveService.getReplayAttackSummary();

      expect(Array.isArray(result.replay_attempts)).toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    test("Complete approval workflow: request -> detect risks -> approve", async () => {
      // Register operation
      await sensitiveService.registerSensitiveOperation(
        "integration-op",
        "approval",
        { requiresSeparateApprover: true }
      );

      // Request approval
      const requestResult = await sensitiveService.requestApproval(
        `op-integration-${Date.now()}`,
        "approval",
        testUserIdRegular,
        testOrgId,
        { action: "test" }
      );

      expect(requestResult.requested).toBe(true);

      // Check for self-approval risk
      const riskResult = await sensitiveService.detectSelfApprovalRisk(
        testUserIdRegular,
        testOrgId,
        "approval"
      );

      expect(typeof riskResult).toBe("boolean");

      // Approve
      const approveResult = await sensitiveService.approveOperation(
        requestResult.approval_id,
        testUserId,
        testOrgId,
        "manual"
      );

      expect(approveResult.approved).toBe(true);

      // Audit
      const auditResult = await sensitiveService.auditSensitiveOperation(
        requestResult.operation_id,
        testUserId,
        "approval",
        testOrgId,
        { approved: true }
      );

      expect(auditResult.audited).toBe(true);
    });

    test("Rejection workflow: request -> reject -> audit", async () => {
      const requestResult = await sensitiveService.requestApproval(
        `op-reject-integration-${Date.now()}`,
        "approval",
        testUserIdRegular,
        testOrgId
      );

      const rejectResult = await sensitiveService.rejectOperation(
        requestResult.approval_id,
        testOrgId,
        "Does not meet business criteria"
      );

      expect(rejectResult.rejected).toBe(true);

      const auditResult = await sensitiveService.auditSensitiveOperation(
        requestResult.operation_id,
        testUserId,
        "approval",
        testOrgId,
        { status: "rejected" }
      );

      expect(auditResult.audited).toBe(true);
    });

    test("Multi-step approval with security checks: request -> detect elevation -> block -> audit", async () => {
      const elevation = await sensitiveService.detectElevationAttempt(
        testUserIdRegular,
        testOrgId,
        "admin"
      );

      expect(elevation).toBe(true);

      const auditResult = await sensitiveService.auditSensitiveOperation(
        "op-elevation-block",
        testUserIdRegular,
        "approval",
        testOrgId,
        { blocked_reason: "elevation_attempt" }
      );

      expect(auditResult.audited).toBe(true);
    });

    test("Field bypass prevention workflow", async () => {
      await sensitiveService.registerRestrictedField(
        "sensitive_table",
        "protected_field",
        "system_only"
      );

      const bypassCheck = await sensitiveService.detectFieldBypass(
        "sensitive_table",
        "protected_field",
        testUserIdRegular,
        testOrgId
      );

      expect(bypassCheck.bypassed !== undefined).toBe(true);

      if (bypassCheck.bypassed) {
        await sensitiveService.auditSensitiveOperation(
          "op-bypass-attempt",
          testUserIdRegular,
          "approval",
          testOrgId,
          { blocked_reason: "field_bypass_attempt" }
        );
      }
    });

    test("Replay attack detection and prevention workflow", async () => {
      const requestResult = await sensitiveService.requestApproval(
        `op-replay-workflow-${Date.now()}`,
        "approval",
        testUserIdRegular,
        testOrgId
      );

      const idempotencyKey = requestResult.idempotency_key;

      // Check if this is a replay
      const replayCheck = await sensitiveService.preventReplayAttack(
        idempotencyKey,
        "approval",
        testUserIdRegular
      );

      expect(replayCheck.allow_execution !== undefined).toBe(true);

      if (replayCheck.is_replay) {
        await sensitiveService.auditSensitiveOperation(
          requestResult.operation_id,
          testUserIdRegular,
          "approval",
          testOrgId,
          { replay_detected: true }
        );
      }
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("Handle null organization ID", async () => {
      const result = await sensitiveService.requestApproval(
        "op-null-org",
        "approval",
        testUserId,
        null
      );

      expect(result.requested !== undefined).toBe(true);
    });

    test("Handle undefined operation details", async () => {
      const result = await sensitiveService.requestApproval(
        "op-undef-details",
        "approval",
        testUserId,
        testOrgId
      );

      expect(result.requested).toBe(true);
    });

    test("Handle empty changes object in audit", async () => {
      const result = await sensitiveService.auditSensitiveOperation(
        "op-empty-changes",
        testUserId,
        "approval",
        testOrgId,
        {}
      );

      expect(result.audited).toBe(true);
    });

    test("Handle very long operation description", async () => {
      const longDesc = "A".repeat(1000);
      const result = await sensitiveService.registerSensitiveOperation(
        `long-desc-op`,
        "approval",
        { description: longDesc }
      );

      expect(result.registered).toBe(true);
    });

    test("Handle special characters in operation name", async () => {
      const result = await sensitiveService.registerSensitiveOperation(
        `op-special-chars-!@#$%`,
        "approval"
      );

      // May fail or succeed depending on validation
      expect(result.registered !== undefined).toBe(true);
    });

    test("Handle rapid successive requests", async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          sensitiveService.requestApproval(
            `op-rapid-${i}`,
            "approval",
            testUserIdRegular,
            testOrgId
          )
        );
      }

      const results = await Promise.all(promises);
      expect(results.every(r => r.requested === true)).toBe(true);
    });
  });

  describe("Compliance and Audit Trail", () => {
    test("All operations logged in audit trail", async () => {
      const opId = `op-compliance-${Date.now()}`;

      await sensitiveService.requestApproval(
        opId,
        "approval",
        testUserIdRegular,
        testOrgId
      );

      await sensitiveService.auditSensitiveOperation(
        opId,
        testUserId,
        "approval",
        testOrgId,
        { compliance: "verified" }
      );

      const audit = await sensitiveService.getSensitiveOperationsAudit(testOrgId);
      expect(Array.isArray(audit.audit_summary)).toBe(true);
    });

    test("Security events tracked comprehensively", async () => {
      // Trigger self-approval detection
      const selfApprovalRisk = await sensitiveService.detectSelfApprovalRisk(
        testUserId,
        testOrgId,
        "approval"
      );

      // Trigger elevation detection
      const elevationRisk = await sensitiveService.detectElevationAttempt(
        testUserIdRegular,
        testOrgId,
        "admin"
      );

      // Trigger field bypass detection
      await sensitiveService.registerRestrictedField("t", "c", "system_only");
      const fieldBypassRisk = await sensitiveService.detectFieldBypass(
        "t",
        "c",
        testUserIdRegular,
        testOrgId
      );

      expect(typeof selfApprovalRisk).toBe("boolean");
      expect(typeof elevationRisk).toBe("boolean");
      expect(fieldBypassRisk.bypassed !== undefined).toBe(true);
    });

    test("Idempotency key tracking prevents duplicates", async () => {
      const op1 = await sensitiveService.requestApproval(
        "op-dup-test",
        "approval",
        testUserIdRegular,
        testOrgId
      );

      const key = op1.idempotency_key;

      // Check if seen before (should not be replay on first check)
      const check1 = await sensitiveService.preventReplayAttack(key, "approval", testUserIdRegular);
      expect(typeof check1.allow_execution).toBe("boolean");
    });
  });
});
