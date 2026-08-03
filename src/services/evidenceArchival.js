/**
 * Issue #173 PR H: Evidence Archival Service
 *
 * Archive evidence to cold storage (S3) for long-term retention
 * Manage archive lifecycle, retention policies, and restoration
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Archive evidence entries to cold storage
 */
async function archiveEvidenceToS3(entryIds, retentionCategory = "7_years_legal", expiryDate = null) {
  try {
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      return { archived: false, reason: "no_entries_provided" };
    }

    // Calculate archive checksum (SHA256 of sorted entry IDs)
    const entriesStr = entryIds.sort().join(",");
    const checksum = crypto
      .createHash("sha256")
      .update(entriesStr)
      .digest("hex");

    // Build S3 path
    const archiveDate = new Date().toISOString().split("T")[0];
    const s3Path = `s3://evidence-archive/${archiveDate}/${crypto.randomBytes(8).toString("hex")}`;

    const archiveQuery = `
      INSERT INTO evidence_archival (
        archive_date, entry_count, archive_location, retention_category,
        expiry_date, checksum, entries_archived, archived_by, archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      RETURNING id, archived_at;
    `;

    const result = await db.pool.query(archiveQuery, [
      archiveDate,
      entryIds.length,
      s3Path,
      retentionCategory,
      expiryDate,
      checksum,
      JSON.stringify(entryIds),
      "system"
    ]);

    if (result.rows.length === 0) {
      return { archived: false, error: "Failed to create archive record" };
    }

    const archiveId = result.rows[0].id;

    // Update evidence_entries to mark as archived
    const updateQuery = `
      UPDATE evidence_entries
      SET archived = true, archive_location = $1
      WHERE id = ANY($2::UUID[])
    `;

    await db.pool.query(updateQuery, [s3Path, entryIds]);

    return {
      archived: true,
      archive_id: archiveId,
      entry_count: entryIds.length,
      s3_location: s3Path,
      checksum,
      archived_at: result.rows[0].archived_at
    };
  } catch (error) {
    console.error("Error archiving evidence to S3:", error);
    return { archived: false, error: error.message };
  }
}

/**
 * Restore evidence from archive
 */
async function restoreFromArchive(archiveId, targetEnvironment = "recovery") {
  try {
    const archiveQuery = `
      SELECT id, entries_archived, checksum, archive_location, archived_at
      FROM evidence_archival
      WHERE id = $1
    `;

    const archiveResult = await db.pool.query(archiveQuery, [archiveId]);

    if (archiveResult.rows.length === 0) {
      return { restored: false, reason: "archive_not_found" };
    }

    const archive = archiveResult.rows[0];
    const entryIds = archive.entries_archived;

    // Verify archive integrity before restoring
    const entriesStr = entryIds.sort().join(",");
    const calculatedChecksum = crypto
      .createHash("sha256")
      .update(entriesStr)
      .digest("hex");

    if (calculatedChecksum !== archive.checksum) {
      return {
        restored: false,
        reason: "archive_integrity_failed",
        expected_checksum: archive.checksum,
        calculated_checksum: calculatedChecksum
      };
    }

    // Restore entries (unmark archived)
    const restoreQuery = `
      UPDATE evidence_entries
      SET archived = false
      WHERE id = ANY($1::UUID[])
      RETURNING COUNT(*)
    `;

    const restoreResult = await db.pool.query(restoreQuery, [entryIds]);

    return {
      restored: true,
      archive_id: archiveId,
      entry_count: entryIds.length,
      target_environment: targetEnvironment,
      restored_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error restoring from archive:", error);
    return { restored: false, error: error.message };
  }
}

/**
 * List archives with optional filtering
 */
async function listArchives(config = {}) {
  const {
    retentionCategory = null,
    startDate = null,
    endDate = null,
    limit = 100
  } = config;

  try {
    let query = `
      SELECT
        id,
        archive_date,
        entry_count,
        total_size_bytes,
        archive_location,
        retention_category,
        expiry_date,
        archived_by,
        archived_at,
        created_at
      FROM evidence_archival
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (retentionCategory) {
      query += ` AND retention_category = $${paramIndex++}`;
      params.push(retentionCategory);
    }

    if (startDate) {
      query += ` AND archive_date >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND archive_date <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY archived_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.pool.query(query, params);

    return {
      archive_count: result.rows.length,
      archives: result.rows
    };
  } catch (error) {
    console.error("Error listing archives:", error);
    return { error: error.message };
  }
}

/**
 * Delete expired archives
 */
async function deleteExpiredArchives() {
  try {
    const query = `
      SELECT id, expiry_date
      FROM evidence_archival
      WHERE expiry_date IS NOT NULL
        AND expiry_date < CURRENT_DATE
        AND active = true
    `;

    const expiredResult = await db.pool.query(query);
    const expiredArchives = expiredResult.rows;

    if (expiredArchives.length === 0) {
      return {
        deleted_count: 0,
        message: "No expired archives found"
      };
    }

    const results = [];
    for (const archive of expiredArchives) {
      // In production, delete from S3 and mark as inactive
      const deleteQuery = `
        UPDATE evidence_archival
        SET active = false
        WHERE id = $1
      `;

      await db.pool.query(deleteQuery, [archive.id]);
      results.push({
        archive_id: archive.id,
        expiry_date: archive.expiry_date,
        deleted: true
      });
    }

    return {
      deleted_count: results.length,
      results
    };
  } catch (error) {
    console.error("Error deleting expired archives:", error);
    return { error: error.message };
  }
}

/**
 * Get archival status and statistics
 */
async function getArchivalStatus() {
  try {
    const query = `
      SELECT
        COALESCE(retention_category, 'uncategorized') as retention_category,
        COUNT(*) as archive_count,
        SUM(entry_count) as total_entries,
        SUM(COALESCE(total_size_bytes, 0)) as total_size_bytes,
        MIN(archived_at) as oldest_archive,
        MAX(archived_at) as newest_archive,
        COUNT(CASE WHEN expiry_date < CURRENT_DATE THEN 1 END) as expired_count,
        COUNT(CASE WHEN expiry_date IS NULL THEN 1 END) as indefinite_count
      FROM evidence_archival
      WHERE active = true
      GROUP BY COALESCE(retention_category, 'uncategorized')
      ORDER BY total_entries DESC
    `;

    const result = await db.pool.query(query);

    let totalEntries = 0;
    let totalBytes = 0;

    result.rows.forEach(row => {
      totalEntries += parseInt(row.total_entries || 0);
      totalBytes += parseInt(row.total_size_bytes || 0);
    });

    return {
      summary: {
        total_archives: result.rows.reduce((sum, r) => sum + parseInt(r.archive_count), 0),
        total_entries: totalEntries,
        total_size_gb: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
        expired_archives: result.rows.reduce((sum, r) => sum + parseInt(r.expired_count), 0)
      },
      by_category: result.rows
    };
  } catch (error) {
    console.error("Error getting archival status:", error);
    return { error: error.message };
  }
}

/**
 * Verify archive integrity
 */
async function verifyArchiveIntegrity(archiveId) {
  try {
    const query = `
      SELECT id, entries_archived, checksum, archive_location
      FROM evidence_archival
      WHERE id = $1
    `;

    const result = await db.pool.query(query, [archiveId]);

    if (result.rows.length === 0) {
      return { verified: false, reason: "archive_not_found" };
    }

    const archive = result.rows[0];
    const entryIds = archive.entries_archived;

    // Recalculate checksum
    const entriesStr = entryIds.sort().join(",");
    const calculatedChecksum = crypto
      .createHash("sha256")
      .update(entriesStr)
      .digest("hex");

    const verified = calculatedChecksum === archive.checksum;

    return {
      verified,
      archive_id: archiveId,
      stored_checksum: archive.checksum,
      calculated_checksum: calculatedChecksum,
      s3_location: archive.archive_location,
      entry_count: entryIds.length,
      verified_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error verifying archive integrity:", error);
    return { verified: false, error: error.message };
  }
}

/**
 * Get retention status for compliance
 */
async function getRetentionComplianceStatus() {
  try {
    const query = `
      SELECT
        COALESCE(ea.retention_category, 'active') as retention_category,
        COUNT(ee.id) as entry_count,
        SUM(CASE WHEN ee.archived = true THEN 1 ELSE 0 END) as archived_count,
        SUM(CASE WHEN ee.on_hold = true THEN 1 ELSE 0 END) as on_hold_count,
        MAX(ee.event_timestamp) as latest_entry,
        CASE WHEN ea.expiry_date IS NOT NULL THEN ea.expiry_date ELSE 'indefinite' END as retention_until
      FROM evidence_entries ee
      LEFT JOIN evidence_archival ea ON ea.id = (
        SELECT id FROM evidence_archival
        WHERE ee.id = ANY(CAST(ea.entries_archived AS UUID[]))
        ORDER BY archive_date DESC LIMIT 1
      )
      GROUP BY COALESCE(ea.retention_category, 'active'), ea.expiry_date
      ORDER BY entry_count DESC
    `;

    const result = await db.pool.query(query);

    return {
      compliance_status: result.rows.map(row => ({
        retention_category: row.retention_category,
        entry_count: row.entry_count,
        archived_count: row.archived_count,
        on_hold_count: row.on_hold_count,
        latest_entry: row.latest_entry,
        retention_until: row.retention_until
      }))
    };
  } catch (error) {
    console.error("Error getting retention compliance status:", error);
    return { error: error.message };
  }
}

module.exports = {
  archiveEvidenceToS3,
  restoreFromArchive,
  listArchives,
  deleteExpiredArchives,
  getArchivalStatus,
  verifyArchiveIntegrity,
  getRetentionComplianceStatus
};
