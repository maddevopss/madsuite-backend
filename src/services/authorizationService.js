/**
 * Issue #174 PR A: Authorization Matrix Service
 *
 * Complete RBAC implementation with route-level permissions,
 * escalation detection, and authorization audit trail
 */

const db = require("../../db");

/**
 * Check if user has permission for a route
 */
async function checkRoutePermission(userId, organizationId, httpMethod, routePath) {
  try {
    // 1. Get route permission requirement
    const routeQuery = `
      SELECT id, required_permission_id, is_sensitive, requires_approval
      FROM route_permissions
      WHERE http_method = $1 AND route_path = $2 AND is_active = true
    `;

    const routeResult = await db.pool.query(routeQuery, [httpMethod, routePath]);

    if (routeResult.rows.length === 0) {
      // Uncovered route - deny by default
      await logAuthorizationDecision(
        userId,
        organizationId,
        "permission_check",
        routePath,
        httpMethod,
        "denied",
        "route_uncovered"
      );
      return { permitted: false, reason: "route_uncovered" };
    }

    const route = routeResult.rows[0];

    // 2. Check user's permissions
    const permissionQuery = `
      SELECT pd.permission_name, rp.condition_type, rp.condition_metadata
      FROM user_role_assignments ura
      JOIN role_definitions rd ON rd.id = ura.role_id
      JOIN role_permissions rp ON rp.role_id = rd.id
      JOIN permission_definitions pd ON pd.id = rp.permission_id
      WHERE ura.user_id = $1
        AND ura.organization_id = $2
        AND pd.id = $3
        AND ura.is_active = true
        AND rd.is_active = true
      LIMIT 1
    `;

    const permResult = await db.pool.query(permissionQuery, [
      userId,
      organizationId,
      route.required_permission_id
    ]);

    if (permResult.rows.length === 0) {
      await logAuthorizationDecision(
        userId,
        organizationId,
        "permission_check",
        routePath,
        httpMethod,
        "denied",
        "permission_not_granted"
      );
      return { permitted: false, reason: "permission_not_granted" };
    }

    const permission = permResult.rows[0];

    // 3. Check for escalation attempts
    const escalationDetected = await detectEscalation(userId, organizationId, permission.permission_name);
    if (escalationDetected) {
      await logAuthorizationDecision(
        userId,
        organizationId,
        "permission_check",
        routePath,
        httpMethod,
        "denied",
        "escalation_attempt"
      );
      return {
        permitted: false,
        reason: "escalation_attempt",
        alert_sent: true
      };
    }

    // 4. Log successful authorization
    await logAuthorizationDecision(
      userId,
      organizationId,
      "permission_check",
      routePath,
      httpMethod,
      "allowed"
    );

    return {
      permitted: true,
      permission: permission.permission_name,
      condition_type: permission.condition_type,
      condition_metadata: permission.condition_metadata,
      is_sensitive: route.is_sensitive,
      requires_approval: route.requires_approval
    };
  } catch (error) {
    console.error("Error checking route permission:", error);
    return { permitted: false, reason: "error", error: error.message };
  }
}

/**
 * Assign role to user in organization
 */
async function assignRoleToUser(userId, organizationId, roleName, assignedBy, scope = "organization") {
  try {
    // Get role ID
    const roleQuery = `
      SELECT id FROM role_definitions
      WHERE role_name = $1 AND is_active = true
    `;

    const roleResult = await db.pool.query(roleQuery, [roleName]);

    if (roleResult.rows.length === 0) {
      return { assigned: false, reason: "role_not_found" };
    }

    const roleId = roleResult.rows[0].id;

    // Assign role
    const assignQuery = `
      INSERT INTO user_role_assignments (
        user_id, organization_id, role_id, assigned_by, scope
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, organization_id, role_id, scope, scope_id)
      DO UPDATE SET is_active = true, assigned_at = CURRENT_TIMESTAMP, assigned_by = $4
      RETURNING id, assigned_at;
    `;

    const result = await db.pool.query(assignQuery, [
      userId,
      organizationId,
      roleId,
      assignedBy,
      scope
    ]);

    // Log assignment
    await logAuthorizationDecision(
      assignedBy,
      organizationId,
      "role_assigned",
      null,
      null,
      "allowed",
      null
    );

    return {
      assigned: true,
      assignment_id: result.rows[0].id,
      user_id: userId,
      role_name: roleName,
      assigned_at: result.rows[0].assigned_at
    };
  } catch (error) {
    console.error("Error assigning role to user:", error);
    return { assigned: false, error: error.message };
  }
}

/**
 * Revoke role from user
 */
async function revokeRoleFromUser(userId, organizationId, roleName, revokedBy) {
  try {
    const revokeQuery = `
      UPDATE user_role_assignments
      SET is_active = false, revoked_at = CURRENT_TIMESTAMP, revoked_by = $4
      WHERE user_id = $1
        AND organization_id = $2
        AND role_id = (
          SELECT id FROM role_definitions WHERE role_name = $3
        )
      RETURNING id, revoked_at;
    `;

    const result = await db.pool.query(revokeQuery, [
      userId,
      organizationId,
      roleName,
      revokedBy
    ]);

    if (result.rows.length === 0) {
      return { revoked: false, reason: "assignment_not_found" };
    }

    // Log revocation
    await logAuthorizationDecision(
      revokedBy,
      organizationId,
      "role_revoked",
      null,
      null,
      "allowed",
      null
    );

    return {
      revoked: true,
      revoked_at: result.rows[0].revoked_at
    };
  } catch (error) {
    console.error("Error revoking role from user:", error);
    return { revoked: false, error: error.message };
  }
}

/**
 * Register a route with permission requirement
 */
async function registerRoute(httpMethod, routePath, routeName, permissionName, config = {}) {
  try {
    const {
      description = "",
      is_sensitive = false,
      requires_approval = false,
      rate_limit_per_hour = null
    } = config;

    // Get permission ID
    const permQuery = `
      SELECT id FROM permission_definitions
      WHERE permission_name = $1
    `;

    const permResult = await db.pool.query(permQuery, [permissionName]);

    if (permResult.rows.length === 0) {
      return { registered: false, reason: "permission_not_found" };
    }

    const permissionId = permResult.rows[0].id;

    // Register route
    const routeQuery = `
      INSERT INTO route_permissions (
        http_method, route_path, route_name, required_permission_id,
        is_sensitive, requires_approval, rate_limit_per_hour, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (http_method, route_path)
      DO UPDATE SET
        required_permission_id = $4,
        is_sensitive = $5,
        requires_approval = $6,
        rate_limit_per_hour = $7,
        description = $8,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, created_at;
    `;

    const result = await db.pool.query(routeQuery, [
      httpMethod,
      routePath,
      routeName,
      permissionId,
      is_sensitive,
      requires_approval,
      rate_limit_per_hour,
      description
    ]);

    return {
      registered: true,
      route_id: result.rows[0].id,
      http_method: httpMethod,
      route_path: routePath,
      permission_name: permissionName
    };
  } catch (error) {
    console.error("Error registering route:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Get user's effective permissions in organization
 */
async function getUserPermissions(userId, organizationId) {
  try {
    const query = `
      SELECT DISTINCT pd.permission_name, pd.category
      FROM user_role_assignments ura
      JOIN role_definitions rd ON rd.id = ura.role_id
      JOIN role_permissions rp ON rp.role_id = rd.id
      JOIN permission_definitions pd ON pd.id = rp.permission_id
      WHERE ura.user_id = $1
        AND ura.organization_id = $2
        AND ura.is_active = true
        AND rd.is_active = true
      ORDER BY pd.category, pd.permission_name
    `;

    const result = await db.pool.query(query, [userId, organizationId]);

    return {
      user_id: userId,
      organization_id: organizationId,
      permission_count: result.rows.length,
      permissions: result.rows
    };
  } catch (error) {
    console.error("Error getting user permissions:", error);
    return { error: error.message };
  }
}

/**
 * Get route coverage report
 */
async function getRouteCoverageReport() {
  try {
    const query = `
      SELECT
        coverage_status,
        COUNT(*) as route_count,
        COUNT(CASE WHEN is_sensitive = true THEN 1 END) as sensitive_routes,
        COUNT(CASE WHEN requires_approval = true THEN 1 END) as approval_required_routes
      FROM route_coverage_status
      WHERE is_active = true
      GROUP BY coverage_status
    `;

    const result = await db.pool.query(query);

    const uncoveredQuery = `
      SELECT http_method, route_path
      FROM route_coverage_status
      WHERE coverage_status = 'uncovered' AND is_active = true
    `;

    const uncoveredResult = await db.pool.query(uncoveredQuery);

    return {
      coverage_summary: result.rows,
      uncovered_routes: uncoveredResult.rows,
      total_uncovered: uncoveredResult.rows.length
    };
  } catch (error) {
    console.error("Error getting route coverage report:", error);
    return { error: error.message };
  }
}

/**
 * Detect permission escalation attempts
 */
async function detectEscalation(userId, organizationId, attemptedPermission) {
  try {
    // Check for self-approval attempts
    if (attemptedPermission.includes("approve")) {
      const selfApprovalQuery = `
        SELECT COUNT(*) as count FROM authorization_audit
        WHERE user_id = $1
          AND organization_id = $2
          AND action_type = 'permission_check'
          AND decision = 'denied'
          AND denial_reason LIKE '%approve%'
          AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
      `;

      const result = await db.pool.query(selfApprovalQuery, [userId, organizationId]);
      if (parseInt(result.rows[0].count) > 3) {
        await recordEscalationAttempt(
          userId,
          organizationId,
          attemptedPermission,
          "self_approval"
        );
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Error detecting escalation:", error);
    return false;
  }
}

/**
 * Record escalation attempt
 */
async function recordEscalationAttempt(userId, organizationId, permission, type) {
  try {
    const query = `
      INSERT INTO permission_escalation_attempts (
        user_id, organization_id, attempted_permission, detection_type, blocked
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;

    await db.pool.query(query, [userId, organizationId, permission, type, true]);
  } catch (error) {
    console.error("Error recording escalation attempt:", error);
  }
}

/**
 * Log authorization decision
 */
async function logAuthorizationDecision(
  userId,
  organizationId,
  actionType,
  routePath,
  httpMethod,
  decision,
  denialReason = null
) {
  try {
    const query = `
      INSERT INTO authorization_audit (
        user_id, organization_id, action_type, route_path, http_method,
        decision, denial_reason, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    `;

    await db.pool.query(query, [
      userId,
      organizationId,
      actionType,
      routePath,
      httpMethod,
      decision,
      denialReason
    ]);
  } catch (error) {
    console.error("Error logging authorization decision:", error);
  }
}

/**
 * Get authorization audit trail
 */
async function getAuthorizationAudit(config = {}) {
  const {
    userId = null,
    organizationId = null,
    decision = null,
    hoursBack = 24,
    limit = 1000
  } = config;

  try {
    let query = `
      SELECT
        user_id,
        organization_id,
        action_type,
        route_path,
        http_method,
        decision,
        denial_reason,
        created_at
      FROM authorization_audit
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${hoursBack} hours'
    `;

    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (organizationId) {
      query += ` AND organization_id = $${paramIndex++}`;
      params.push(organizationId);
    }

    if (decision) {
      query += ` AND decision = $${paramIndex++}`;
      params.push(decision);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.pool.query(query, params);

    return {
      audit_entries: result.rows.length,
      entries: result.rows
    };
  } catch (error) {
    console.error("Error getting authorization audit:", error);
    return { error: error.message };
  }
}

module.exports = {
  checkRoutePermission,
  assignRoleToUser,
  revokeRoleFromUser,
  registerRoute,
  getUserPermissions,
  getRouteCoverageReport,
  detectEscalation,
  recordEscalationAttempt,
  logAuthorizationDecision,
  getAuthorizationAudit
};
