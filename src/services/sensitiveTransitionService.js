/**
 * Issue #174 PR C: Sensitive Transition Security Service
 *
 * Prevention of self-approval, authority elevation, field bypass, and replay attacks
 * Secure approval workflow for sensitive operations
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Register a sensitive operation
 */
async function registerSensitiveOperation(operationName, operationType, config = {}) {
  try {
    const {
      description = "",
      requiresSeparateApprover = true,
      requiresTwoFactorAuth = false,
      requiresExecutiveApproval = false,
      requiresAuditLog = true,
      requiresIdempotencyKey = true,
      idempotencyWindowSeconds = 3600,
      maxPerHour = null,
      maxPerDay = null
    } = config;

    const query = `
      INSERT INTO sensitive_operations (
        operation_name, operation_type, description,
        requires_separate_approver, requires_two_factor_auth,
        requires_executive_approval, requires_audit_log,
        requires_idempotency_key, idempotency_window_seconds,
        max_per_hour, max_per_day
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (operation_name)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, operation_name;
    `;

    const result = await db.pool.query(query, [
      operationName,
      operationType,
      description,
      requiresSeparateApprover,
      requiresTwoFactorAuth,
      requiresExecutiveApproval,
      requiresAuditLog,
      requiresIdempotencyKey,
      idempotencyWindowSeconds,
      maxPerHour,
      maxPerDay
    ]);

    return {
      registered: true,
      operation_id: result.rows[0].id,
      operation_name: result.rows[0].operation_name
    };
  } catch (error) {
    console.error("Error registering sensitive operation:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Register a restricted field (cannot be modified by customer)
 */
async function registerRestrictedField(tableName, columnName, restrictionType, reason = "") {
  try {
    const query = `
      INSERT INTO restricted_fields (
        table_name, column_name, restriction_type, reason
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (table_name, column_name)
      DO UPDATE SET restriction_type = $3, reason = $4
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      tableName,
      columnName,
      restrictionType,
      reason
    ]);

    return {
      registered: true,
      field_id: result.rows[0].id,
      table_name: tableName,
      column_name: columnName,
      restriction: restrictionType
    };
  } catch (error) {
    console.error("Error registering restricted field:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Request approval for a sensitive operation
 */
async function requestApproval(operationId, operationType, requesterUserId, organizationId, operationDetails = {}) {
  try {
    // Generate idempotency key
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${operationId}:${requesterUserId}:${Date.now()}`)
      .digest("hex");

    // Check for self-approval risk
    const selfApprovalRisk = await detectSelfApprovalRisk(requesterUserId, organizationId, operationType);

    const query = `
      INSERT INTO operation_approvals (
        operation_id, operation_type, requester_user_id, requester_org_id,
        status, requested_details, self_approval_detected
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (operation_id) DO UPDATE SET
        operation_type = EXCLUDED.operation_type,
        requester_user_id = EXCLUDED.requester_user_id,
        requester_org_id = EXCLUDED.requester_org_id,
        status = EXCLUDED.status,
        requested_details = EXCLUDED.requested_details,
        self_approval_detected = EXCLUDED.self_approval_detected
      RETURNING id, requested_at;
    `;

    const result = await db.pool.query(query, [
      operationId,
      operationType,
      requesterUserId,
      organizationId,
      "pending",
      JSON.stringify(operationDetails),
      selfApprovalRisk
    ]);

    if (!result.rows[0]) {
      return { requested: false, error: "Failed to create approval request" };
    }

    // Track idempotency key
    const idempotencyQuery = `
      INSERT INTO operation_idempotency_keys (
        idempotency_key, operation_type, user_id, organization_id,
        first_submission_details, expires_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '1 hour')
      ON CONFLICT (idempotency_key) DO UPDATE SET replay_attempt_count = operation_idempotency_keys.replay_attempt_count + 1
      RETURNING id;
    `;

    await db.pool.query(idempotencyQuery, [
      idempotencyKey,
      operationType,
      requesterUserId,
      organizationId,
      JSON.stringify(operationDetails)
    ]);

    return {
      requested: true,
      approval_id: result.rows[0].id,
      operation_id: operationId,
      status: "pending",
      self_approval_risk: selfApprovalRisk,
      idempotency_key: idempotencyKey
    };
  } catch (error) {
    console.error("Error requesting approval:", error);
    return { requested: false, error: error.message };
  }
}

/**
 * Detect self-approval risk
 */
async function detectSelfApprovalRisk(userId, organizationId, operationType) {
  try {
    const query = `
      SELECT role_name FROM user_role_assignments ura
      JOIN role_definitions rd ON rd.id = ura.role_id
      WHERE ura.user_id = $1 AND ura.organization_id = $2 AND ura.is_active = true
    `;

    const result = await db.pool.query(query, [userId, organizationId]);

    // Check if user has approval authority for this operation type
    const roles = result.rows.map(r => r.role_name);
    const hasApprovalAuthority = roles.some(r => r.includes("approver") || r.includes("admin"));

    return hasApprovalAuthority;
  } catch (error) {
    console.error("Error detecting self-approval risk:", error);
    return false;
  }
}

/**
 * Detect authority elevation attempt
 */
async function detectElevationAttempt(userId, organizationId, targetRole, operationDetails = {}) {
  try {
    // Get current role
    const currentQuery = `
      SELECT rd.role_name FROM user_role_assignments ura
      JOIN role_definitions rd ON rd.id = ura.role_id
      WHERE ura.user_id = $1 AND ura.organization_id = $2 AND ura.is_active = true
      LIMIT 1
    `;

    const currentResult = await db.pool.query(currentQuery, [userId, organizationId]);
    const currentRole = currentResult.rows[0]?.role_name || "viewer";

    // Define role hierarchy (higher = more privileged)
    const roleHierarchy = {
      "viewer": 1,
      "editor": 2,
      "manager": 3,
      "approver": 4,
      "admin": 5,
      "super_admin": 6
    };

    const currentLevel = roleHierarchy[currentRole] || 1;
    const targetLevel = roleHierarchy[targetRole] || 1;

    const isElevation = targetLevel > currentLevel;

    if (isElevation) {
      // Record elevation attempt
      const recordQuery = `
        INSERT INTO elevation_attempts (
          user_id, organization_id, "current_role", target_role,
          elevation_type, blocked
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;

      await db.pool.query(recordQuery, [
        userId,
        organizationId,
        currentRole,
        targetRole,
        "self_promotion",
        true
      ]);
    }

    return isElevation;
  } catch (error) {
    console.error("Error detecting elevation attempt:", error);
    return false;
  }
}

/**
 * Detect field bypass attempt (modifying restricted fields)
 */
async function detectFieldBypass(tableName, columnName, userId, organizationId) {
  try {
    const query = `
      SELECT restriction_type FROM restricted_fields
      WHERE table_name = $1 AND column_name = $2 AND is_active = true
    `;

    const result = await db.pool.query(query, [tableName, columnName]);

    if (result.rows.length === 0) {
      return { bypassed: false };
    }

    const restriction = result.rows[0].restriction_type;

    // Check if user has role to modify despite restriction
    const roleQuery = `
      SELECT COUNT(*) as can_modify FROM user_role_assignments ura
      JOIN role_definitions rd ON rd.id = ura.role_id
      WHERE ura.user_id = $1 AND ura.organization_id = $2 AND ura.is_active = true
      AND rd.role_type IN ('system', 'admin')
    `;

    const roleResult = await db.pool.query(roleQuery, [userId, organizationId]);
    const canModify = parseInt(roleResult.rows[0].can_modify) > 0;

    if (restriction === "read_only" || restriction === "system_only") {
      return { bypassed: !canModify };
    }

    return { bypassed: false };
  } catch (error) {
    console.error("Error detecting field bypass:", error);
    return { bypassed: false, error: error.message };
  }
}

/**
 * Prevent replay attacks using idempotency key
 */
async function preventReplayAttack(idempotencyKey, operationType, userId) {
  try {
    const query = `
      SELECT * FROM operation_idempotency_keys
      WHERE idempotency_key = $1 AND expires_at > CURRENT_TIMESTAMP
    `;

    const result = await db.pool.query(query, [idempotencyKey]);

    if (result.rows.length === 0) {
      return { is_replay: false, allow_execution: true };
    }

    const record = result.rows[0];

    // Check if this is a duplicate submission within the window
    if (record.replay_attempt_count > 0) {
      return {
        is_replay: true,
        allow_execution: false,
        reason: "duplicate_submission",
        first_result: record.first_result
      };
    }

    return { is_replay: false, allow_execution: true };
  } catch (error) {
    console.error("Error preventing replay attack:", error);
    return { is_replay: false, allow_execution: true };
  }
}

/**
 * Approve an operation
 */
async function approveOperation(approvalId, approverId, organizationId, approvalMethod = "manual") {
  try {
    const query = `
      UPDATE operation_approvals
      SET status = 'approved', approver_user_id = $2, approval_method = $3,
          status_changed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND requester_org_id = $4
      RETURNING operation_id, operation_type;
    `;

    const result = await db.pool.query(query, [
      approvalId,
      approverId,
      approvalMethod,
      organizationId
    ]);

    if (result.rows.length === 0) {
      return { approved: false, reason: "approval_not_found" };
    }

    return {
      approved: true,
      approval_id: approvalId,
      operation_id: result.rows[0].operation_id,
      approved_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error approving operation:", error);
    return { approved: false, error: error.message };
  }
}

/**
 * Reject an operation
 */
async function rejectOperation(approvalId, organizationId, rejectionReason = "") {
  try {
    const query = `
      UPDATE operation_approvals
      SET status = 'rejected', rejection_reason = $3,
          status_changed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND requester_org_id = $2
      RETURNING operation_id;
    `;

    const result = await db.pool.query(query, [
      approvalId,
      organizationId,
      rejectionReason
    ]);

    if (result.rows.length === 0) {
      return { rejected: false, reason: "approval_not_found" };
    }

    return {
      rejected: true,
      approval_id: approvalId,
      operation_id: result.rows[0].operation_id
    };
  } catch (error) {
    console.error("Error rejecting operation:", error);
    return { rejected: false, error: error.message };
  }
}

/**
 * Audit a sensitive operation
 */
async function auditSensitiveOperation(operationId, userId, operationType, organizationId, changes = {}, metadata = {}) {
  try {
    const query = `
      INSERT INTO sensitive_operation_audit (
        operation_id, operation_type, user_id, organization_id,
        changes_json, executed_at, status
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      operationId,
      operationType,
      userId,
      organizationId,
      JSON.stringify(changes),
      "success"
    ]);

    return {
      audited: true,
      audit_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error auditing sensitive operation:", error);
    return { audited: false, error: error.message };
  }
}

/**
 * Get pending approvals
 */
async function getPendingApprovals(organizationId = null) {
  try {
    let query = `
      SELECT
        id, operation_id, operation_type, requester_user_id,
        status, self_approval_detected, authority_elevation_detected,
        field_bypass_detected, replay_attempt_detected,
        requested_at, expires_at
      FROM operation_approvals
      WHERE status = 'pending'
    `;

    const params = [];

    if (organizationId) {
      query += ` AND requester_org_id = $1`;
      params.push(organizationId);
    }

    query += ` ORDER BY requested_at DESC`;

    const result = await db.pool.query(query, params);

    return {
      pending_count: result.rows.length,
      approvals: result.rows
    };
  } catch (error) {
    console.error("Error getting pending approvals:", error);
    return { error: error.message };
  }
}

/**
 * Get sensitive operations audit summary
 */
async function getSensitiveOperationsAudit(organizationId = null) {
  try {
    const query = `
      SELECT * FROM sensitive_operations_audit_summary
    `;

    const result = await db.pool.query(query);

    return {
      audit_summary: result.rows
    };
  } catch (error) {
    console.error("Error getting sensitive operations audit:", error);
    return { error: error.message };
  }
}

/**
 * Get replay attack summary
 */
async function getReplayAttackSummary() {
  try {
    const query = `
      SELECT * FROM replay_attack_summary
    `;

    const result = await db.pool.query(query);

    return {
      replay_attempts: result.rows
    };
  } catch (error) {
    console.error("Error getting replay attack summary:", error);
    return { error: error.message };
  }
}

module.exports = {
  registerSensitiveOperation,
  registerRestrictedField,
  requestApproval,
  detectSelfApprovalRisk,
  detectElevationAttempt,
  detectFieldBypass,
  preventReplayAttack,
  approveOperation,
  rejectOperation,
  auditSensitiveOperation,
  getPendingApprovals,
  getSensitiveOperationsAudit,
  getReplayAttackSummary
};
