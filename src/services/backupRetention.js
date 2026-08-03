/**
 * Issue #173 PR G: Backup Retention Service
 *
 * Manages backup retention policies and automatic cleanup
 * Enforces storage quotas and minimum backup counts
 */

const db = require("../../db");

/**
 * Get retention policy for backup type
 */
async function getRetentionPolicy(backupType) {
  try {
    const query = `
      SELECT * FROM backup_retention_policy
      WHERE backup_type = $1
    `;

    const result = await db.pool.query(query, [backupType]);

    if (result.rows.length === 0) {
      return { error: "Policy not found" };
    }

    return result.rows[0];
  } catch (error) {
    console.error("Error getting retention policy:", error);
    return { error: error.message };
  }
}

/**
 * Get all retention policies
 */
async function getAllRetentionPolicies() {
  try {
    const query = `
      SELECT * FROM backup_retention_policy
      ORDER BY backup_type
    `;

    const result = await db.pool.query(query);
    return result.rows;
  } catch (error) {
    console.error("Error getting all retention policies:", error);
    return [];
  }
}

/**
 * Update retention policy
 */
async function updateRetentionPolicy(backupType, config) {
  const {
    retentionDays = null,
    minBackupsToKeep = null,
    sizeQuotaGb = null,
    autoPurge = null
  } = config;

  try {
    let query = `UPDATE backup_retention_policy SET `;
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (retentionDays !== null) {
      updates.push(`retention_days = $${paramIndex++}`);
      params.push(retentionDays);
    }

    if (minBackupsToKeep !== null) {
      updates.push(`min_backups_to_keep = $${paramIndex++}`);
      params.push(minBackupsToKeep);
    }

    if (sizeQuotaGb !== null) {
      updates.push(`size_quota_gb = $${paramIndex++}`);
      params.push(sizeQuotaGb);
    }

    if (autoPurge !== null) {
      updates.push(`auto_purge = $${paramIndex++}`);
      params.push(autoPurge);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    query += updates.join(", ");
    query += ` WHERE backup_type = $${paramIndex}`;
    params.push(backupType);

    await db.pool.query(query, params);

    return await getRetentionPolicy(backupType);
  } catch (error) {
    console.error("Error updating retention policy:", error);
    return { error: error.message };
  }
}

/**
 * Apply retention policy to all backups
 * Deletes old backups exceeding retention policy
 */
async function applyRetentionPolicy() {
  try {
    const policies = await getAllRetentionPolicies();
    const results = [];

    for (const policy of policies) {
      const result = await applyPolicyForType(policy);
      results.push(result);
    }

    return {
      policies_applied: results.length,
      results,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error applying retention policies:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Apply retention policy for specific backup type
 */
async function applyPolicyForType(policy) {
  try {
    const {
      backup_type,
      retention_days,
      min_backups_to_keep,
      size_quota_gb,
      auto_purge
    } = policy;

    if (!auto_purge) {
      return {
        backup_type,
        applied: false,
        reason: "auto_purge_disabled"
      };
    }

    const deletedSnapshots = [];

    // Step 1: Delete backups exceeding retention period
    // But keep minimum backups to keep
    const retentionQuery = `
      SELECT id, total_size_bytes FROM backup_snapshots
      WHERE backup_type = $1
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '${retention_days} days'
        AND id NOT IN (
          SELECT id FROM backup_snapshots
          WHERE backup_type = $1
          ORDER BY created_at DESC
          LIMIT $2
        )
      ORDER BY created_at ASC
    `;

    const retentionResult = await db.pool.query(retentionQuery, [
      backup_type,
      min_backups_to_keep
    ]);

    for (const backup of retentionResult.rows) {
      await db.pool.query("DELETE FROM backup_snapshots WHERE id = $1", [
        backup.id
      ]);
      deletedSnapshots.push({
        id: backup.id,
        reason: "retention_policy"
      });
    }

    // Step 2: Check size quota
    if (size_quota_gb) {
      const sizeQuery = `
        SELECT SUM(COALESCE(total_size_bytes, 0)) as total_size
        FROM backup_snapshots
        WHERE backup_type = $1
      `;

      const sizeResult = await db.pool.query(sizeQuery, [backup_type]);
      const totalSizeBytes = sizeResult.rows[0]?.total_size || 0;
      const totalSizeGb = totalSizeBytes / (1024 * 1024 * 1024);

      if (totalSizeGb > size_quota_gb) {
        // Delete oldest backups until under quota
        const overQuotaSize = totalSizeGb - size_quota_gb;
        const quotaQuery = `
          SELECT id, total_size_bytes FROM backup_snapshots
          WHERE backup_type = $1
            AND id NOT IN (
              SELECT id FROM backup_snapshots
              WHERE backup_type = $1
              ORDER BY created_at DESC
              LIMIT $2
            )
          ORDER BY created_at ASC
          LIMIT 100
        `;

        const quotaResult = await db.pool.query(quotaQuery, [
          backup_type,
          min_backups_to_keep
        ]);

        let freedSize = 0;
        for (const backup of quotaResult.rows) {
          if (freedSize >= overQuotaSize * 1024 * 1024 * 1024) {
            break;
          }

          await db.pool.query("DELETE FROM backup_snapshots WHERE id = $1", [
            backup.id
          ]);

          deletedSnapshots.push({
            id: backup.id,
            reason: "size_quota_exceeded"
          });

          freedSize += backup.total_size_bytes || 0;
        }
      }
    }

    return {
      backup_type,
      applied: true,
      deleted_snapshots: deletedSnapshots.length,
      details: deletedSnapshots
    };
  } catch (error) {
    console.error(`Error applying policy for ${policy.backup_type}:`, error);
    return {
      backup_type: policy.backup_type,
      applied: false,
      error: error.message
    };
  }
}

/**
 * Check current backup storage usage
 */
async function getStorageUsage() {
  try {
    const query = `
      SELECT
        backup_type,
        COUNT(*) as backup_count,
        SUM(COALESCE(total_size_bytes, 0))::BIGINT as total_size_bytes,
        SUM(COALESCE(total_rows_backed_up, 0))::BIGINT as total_rows
      FROM backup_snapshots
      GROUP BY backup_type
      ORDER BY total_size_bytes DESC
    `;

    const result = await db.pool.query(query);

    const usage = result.rows.map(row => ({
      backup_type: row.backup_type,
      backup_count: row.backup_count,
      total_size_bytes: row.total_size_bytes || 0,
      total_size_gb: ((row.total_size_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2),
      total_rows: row.total_rows || 0
    }));

    const totalSize = usage.reduce((sum, u) => sum + (u.total_size_bytes || 0), 0);

    return {
      by_type: usage,
      total_size_bytes: totalSize,
      total_size_gb: (totalSize / (1024 * 1024 * 1024)).toFixed(2),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error getting storage usage:", error);
    return { error: error.message };
  }
}

/**
 * Get backup retention status
 * Shows which backups will be retained vs deleted
 */
async function getRetentionStatus() {
  try {
    const policies = await getAllRetentionPolicies();
    const status = [];

    for (const policy of policies) {
      const policyStatus = {
        backup_type: policy.backup_type,
        retention_days: policy.retention_days,
        min_backups_to_keep: policy.min_backups_to_keep,
        auto_purge: policy.auto_purge
      };

      // Count backups by retention status
      const countQuery = `
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${policy.retention_days} days') as within_retention,
          COUNT(*) FILTER (WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${policy.retention_days} days') as exceeds_retention
        FROM backup_snapshots
        WHERE backup_type = $1
      `;

      const countResult = await db.pool.query(countQuery, [policy.backup_type]);
      policyStatus.backup_counts = countResult.rows[0];

      status.push(policyStatus);
    }

    return {
      retention_status: status,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error getting retention status:", error);
    return { error: error.message };
  }
}

/**
 * Manually delete old backups
 */
async function deleteBackupsOlderThan(days) {
  try {
    const query = `
      DELETE FROM backup_snapshots
      WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${days} days'
      RETURNING id, backup_type, total_size_bytes
    `;

    const result = await db.pool.query(query);

    const freedSpace = result.rows.reduce(
      (sum, row) => sum + (row.total_size_bytes || 0),
      0
    );

    return {
      deleted_snapshots: result.rowCount,
      freed_space_bytes: freedSpace,
      freed_space_gb: (freedSpace / (1024 * 1024 * 1024)).toFixed(2),
      deleted_ids: result.rows.map(r => r.id),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error deleting old backups:", error);
    return {
      error: error.message
    };
  }
}

module.exports = {
  getRetentionPolicy,
  getAllRetentionPolicies,
  updateRetentionPolicy,
  applyRetentionPolicy,
  applyPolicyForType,
  getStorageUsage,
  getRetentionStatus,
  deleteBackupsOlderThan
};
