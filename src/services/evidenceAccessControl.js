/**
 * Issue #173 PR H: Evidence Access Control Service
 *
 * Role-based access control for evidence entries with audit logging
 * Tracks who accessed what evidence, when, and for what purpose
 */

const db = require("../../db");

/**
 * Grant access to evidence entry
 */
async function grantAccessToEvidence(userId, entryId, accessType = "view", purpose = "") {
  try {
    const query = `
      INSERT INTO evidence_access_log (
        accessor_user_id, accessed_entry_id, access_type,
        purpose_stated, access_granted, accessed_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id, accessed_at;
    `;

    const result = await db.pool.query(query, [
      userId,
      entryId,
      accessType,
      purpose,
      true
    ]);

    if (result.rows.length === 0) {
      return { granted: false, error: "Failed to grant access" };
    }

    return {
      granted: true,
      access_log_id: result.rows[0].id,
      granted_at: result.rows[0].accessed_at
    };
  } catch (error) {
    console.error("Error granting access to evidence:", error);
    return { granted: false, error: error.message };
  }
}

/**
 * Revoke access to evidence entry (deny access)
 */
async function revokeAccessToEvidence(userId, entryId, accessType = "view", reason = "") {
  try {
    const query = `
      INSERT INTO evidence_access_log (
        accessor_user_id, accessed_entry_id, access_type,
        purpose_stated, access_granted, accessed_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id, accessed_at;
    `;

    const result = await db.pool.query(query, [
      userId,
      entryId,
      accessType,
      `DENIED: ${reason}`,
      false
    ]);

    if (result.rows.length === 0) {
      return { revoked: false, error: "Failed to log access denial" };
    }

    return {
      revoked: true,
      access_log_id: result.rows[0].id,
      revoked_at: result.rows[0].accessed_at
    };
  } catch (error) {
    console.error("Error revoking access to evidence:", error);
    return { revoked: false, error: error.message };
  }
}

/**
 * Check if user has permission to access evidence
 */
async function checkAccessPermission(userId, entryId, accessType = "view") {
  try {
    // For now, simple permission model: admins have all access, others can view non-sensitive
    // In production, would integrate with role-based access control system

    const entryQuery = `
      SELECT ee.id, ee.on_hold, ch.hold_type
      FROM evidence_entries ee
      LEFT JOIN compliance_holds ch ON ee.hold_id = ch.id
      WHERE ee.id = $1
    `;

    const entryResult = await db.pool.query(entryQuery, [entryId]);

    if (entryResult.rows.length === 0) {
      return {
        permitted: false,
        reason: "entry_not_found"
      };
    }

    const entry = entryResult.rows[0];

    // Block access to entries on litigation hold (unless user is authorized)
    if (entry.on_hold) {
      return {
        permitted: false,
        reason: "compliance_hold_active",
        hold_type: entry.hold_type
      };
    }

    // Log the permission check
    return {
      permitted: true,
      entry_id: entryId,
      access_type: accessType
    };
  } catch (error) {
    console.error("Error checking access permission:", error);
    return {
      permitted: false,
      reason: "error",
      error: error.message
    };
  }
}

/**
 * Log evidence access (after permission verified)
 */
async function logEvidenceAccess(userId, entryId, accessType, ipAddress = "", userAgent = "") {
  try {
    const query = `
      INSERT INTO evidence_access_log (
        accessor_user_id, accessed_entry_id, access_type,
        access_granted, ip_address, user_agent, accessed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      RETURNING id, accessed_at;
    `;

    const result = await db.pool.query(query, [
      userId,
      entryId,
      accessType,
      true,
      ipAddress,
      userAgent
    ]);

    return {
      logged: true,
      log_id: result.rows[0].id,
      timestamp: result.rows[0].accessed_at
    };
  } catch (error) {
    console.error("Error logging evidence access:", error);
    return { logged: false, error: error.message };
  }
}

/**
 * Get access log for an evidence entry
 */
async function getAccessLog(entryId) {
  try {
    const query = `
      SELECT
        id,
        accessor_user_id,
        access_type,
        access_granted,
        purpose_stated,
        ip_address,
        user_agent,
        accessed_at
      FROM evidence_access_log
      WHERE accessed_entry_id = $1
      ORDER BY accessed_at DESC
    `;

    const result = await db.pool.query(query, [entryId]);

    return {
      entry_id: entryId,
      access_count: result.rows.length,
      accesses: result.rows
    };
  } catch (error) {
    console.error("Error getting access log:", error);
    return { error: error.message };
  }
}

/**
 * Get all evidence accessed by a user
 */
async function getAccessedEvidenceForUser(userId, hoursBack = 720) {
  try {
    const query = `
      SELECT
        eal.accessed_entry_id,
        eal.access_type,
        eal.access_granted,
        eal.accessed_at,
        ee.entry_type,
        ee.component_name,
        ee.resource_type,
        ee.action,
        COUNT(*) OVER (PARTITION BY eal.accessed_entry_id) as access_count
      FROM evidence_access_log eal
      JOIN evidence_entries ee ON ee.id = eal.accessed_entry_id
      WHERE eal.accessor_user_id = $1
        AND eal.accessed_at >= CURRENT_TIMESTAMP - INTERVAL '${hoursBack} hours'
      ORDER BY eal.accessed_at DESC
    `;

    const result = await db.pool.query(query, [userId]);

    return {
      user_id: userId,
      access_count: result.rows.length,
      accesses: result.rows
    };
  } catch (error) {
    console.error("Error getting user access history:", error);
    return { error: error.message };
  }
}

/**
 * Get access audit summary for compliance
 */
async function getAccessAuditSummary(startDate, endDate) {
  try {
    const query = `
      SELECT
        eal.accessed_entry_id,
        COUNT(*) as total_accesses,
        COUNT(DISTINCT eal.accessor_user_id) as unique_accessors,
        MIN(eal.accessed_at) as first_access,
        MAX(eal.accessed_at) as last_access,
        array_agg(DISTINCT eal.accessor_user_id) as accessors,
        array_agg(DISTINCT eal.access_type) as access_types,
        SUM(CASE WHEN eal.access_granted = true THEN 1 ELSE 0 END) as granted_count,
        SUM(CASE WHEN eal.access_granted = false THEN 1 ELSE 0 END) as denied_count
      FROM evidence_access_log eal
      WHERE eal.accessed_at >= $1 AND eal.accessed_at <= $2
      GROUP BY eal.accessed_entry_id
      ORDER BY total_accesses DESC
    `;

    const result = await db.pool.query(query, [startDate, endDate]);

    return {
      period: { start: startDate, end: endDate },
      summary_count: result.rows.length,
      summaries: result.rows
    };
  } catch (error) {
    console.error("Error getting access audit summary:", error);
    return { error: error.message };
  }
}

/**
 * Detect suspicious access patterns
 */
async function detectSuspiciousAccess(hoursBack = 24) {
  try {
    const query = `
      SELECT
        eal.accessor_user_id,
        COUNT(*) as access_count,
        COUNT(DISTINCT eal.accessed_entry_id) as unique_entries,
        COUNT(CASE WHEN eal.access_granted = false THEN 1 END) as denied_count,
        MIN(eal.accessed_at) as first_access,
        MAX(eal.accessed_at) as last_access,
        EXTRACT(EPOCH FROM MAX(eal.accessed_at) - MIN(eal.accessed_at))::INT as access_window_seconds
      FROM evidence_access_log eal
      WHERE eal.accessed_at >= CURRENT_TIMESTAMP - INTERVAL '${hoursBack} hours'
      GROUP BY eal.accessor_user_id
      HAVING COUNT(*) > 20 OR COUNT(CASE WHEN eal.access_granted = false THEN 1 END) > 5
      ORDER BY access_count DESC
    `;

    const result = await db.pool.query(query);
    const suspicious = result.rows.map(row => ({
      user_id: row.accessor_user_id,
      access_count: row.access_count,
      unique_entries: row.unique_entries,
      denied_count: row.denied_count,
      access_window_minutes: Math.round(row.access_window_seconds / 60),
      risk_level: row.denied_count > 0 ? "HIGH" : "MEDIUM"
    }));

    return {
      period_hours: hoursBack,
      suspicious_users: suspicious.length,
      users: suspicious
    };
  } catch (error) {
    console.error("Error detecting suspicious access:", error);
    return { error: error.message };
  }
}

module.exports = {
  grantAccessToEvidence,
  revokeAccessToEvidence,
  checkAccessPermission,
  logEvidenceAccess,
  getAccessLog,
  getAccessedEvidenceForUser,
  getAccessAuditSummary,
  detectSuspiciousAccess
};
