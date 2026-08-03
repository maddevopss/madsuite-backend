/**
 * Issue #173 PR H: Evidence Collector Service
 *
 * Captures operations and state changes as immutable evidence entries
 * Integrates with operation_logs to create audit trail
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Capture operation from operation_logs as evidence entry
 */
async function captureOperationAsEvidence(operation) {
  const {
    id,
    operation_type,
    component_name,
    resource_type,
    resource_id,
    action,
    status,
    user_id,
    message,
    details,
    created_at,
    severity
  } = operation;

  try {
    // Calculate evidence hash
    const hashData = `${operation_type}:${resource_id}:${created_at}:${action}`;
    const evidenceHash = crypto
      .createHash("sha256")
      .update(hashData)
      .digest("hex");

    const query = `
      INSERT INTO evidence_entries (
        entry_type, component_name, resource_type, resource_id,
        action, status, initiator_user_id, initiator_reason,
        evidence_hash, metadata, event_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      operation_type,
      component_name,
      resource_type,
      resource_id,
      action,
      status,
      user_id,
      `operation: ${message}`,
      evidenceHash,
      JSON.stringify(details),
      new Date(created_at)
    ]);

    // Create chain entry
    if (result.rows.length > 0) {
      await createChainEntry(result.rows[0].id, evidenceHash);
    }

    return {
      evidence_id: result.rows[0].id,
      captured: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error capturing operation as evidence:", error);
    return {
      captured: false,
      error: error.message
    };
  }
}

/**
 * Capture state change as evidence
 */
async function captureStateChange(componentName, resourceType, resourceId, beforeState, afterState) {
  try {
    // Determine what changed
    const changes = [];
    const allKeys = new Set([
      ...Object.keys(beforeState || {}),
      ...Object.keys(afterState || {})
    ]);

    for (const key of allKeys) {
      const before = beforeState?.[key];
      const after = afterState?.[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changes.push({ field: key, before, after });
      }
    }

    if (changes.length === 0) {
      return { captured: false, reason: "no_changes" };
    }

    // Calculate hash
    const hashData = `${resourceType}:${resourceId}:${JSON.stringify(changes)}`;
    const evidenceHash = crypto
      .createHash("sha256")
      .update(hashData)
      .digest("hex");

    const query = `
      INSERT INTO evidence_entries (
        entry_type, component_name, resource_type, resource_id,
        action, status, before_state, after_state,
        evidence_hash, metadata, event_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      "state_change",
      componentName,
      resourceType,
      resourceId,
      "UPDATE",
      "completed",
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      evidenceHash,
      JSON.stringify({ changes }),
      new Date()
    ]);

    if (result.rows.length > 0) {
      await createChainEntry(result.rows[0].id, evidenceHash);
    }

    return {
      evidence_id: result.rows[0].id,
      captured: true,
      changes_count: changes.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error capturing state change:", error);
    return {
      captured: false,
      error: error.message
    };
  }
}

/**
 * Capture backup operation as evidence
 */
async function captureBackupEvidence(backupSnapshot, backupComponents) {
  try {
    const hashData = `backup:${backupSnapshot.id}:${backupSnapshot.created_at}`;
    const evidenceHash = crypto
      .createHash("sha256")
      .update(hashData)
      .digest("hex");

    const query = `
      INSERT INTO evidence_entries (
        entry_type, component_name, resource_type, resource_id,
        action, status, evidence_hash, metadata, event_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      "backup",
      "backup_restore",
      "backup",
      backupSnapshot.id,
      "BACKUP",
      "completed",
      evidenceHash,
      JSON.stringify({
        backup_type: backupSnapshot.backup_type,
        total_size_bytes: backupSnapshot.total_size_bytes,
        components: backupComponents
      }),
      new Date(backupSnapshot.created_at)
    ]);

    if (result.rows.length > 0) {
      await createChainEntry(result.rows[0].id, evidenceHash);
    }

    return {
      evidence_id: result.rows[0].id,
      captured: true
    };
  } catch (error) {
    console.error("Error capturing backup evidence:", error);
    return {
      captured: false,
      error: error.message
    };
  }
}

/**
 * Capture restore operation as evidence
 */
async function captureRestoreEvidence(restoreOperation, restoredComponents) {
  try {
    const hashData = `restore:${restoreOperation.id}:${restoreOperation.created_at}`;
    const evidenceHash = crypto
      .createHash("sha256")
      .update(hashData)
      .digest("hex");

    const query = `
      INSERT INTO evidence_entries (
        entry_type, component_name, resource_type, resource_id,
        action, status, initiator_user_id, evidence_hash, metadata, event_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      "restore",
      "backup_restore",
      "restore",
      restoreOperation.id,
      "RESTORE",
      restoreOperation.status,
      restoreOperation.initiated_by,
      evidenceHash,
      JSON.stringify({
        source_snapshot_id: restoreOperation.source_snapshot_id,
        target_environment: restoreOperation.target_environment,
        total_rows_restored: restoreOperation.total_rows_restored,
        components_restored: restoredComponents
      }),
      new Date(restoreOperation.created_at)
    ]);

    if (result.rows.length > 0) {
      await createChainEntry(result.rows[0].id, evidenceHash);
    }

    return {
      evidence_id: result.rows[0].id,
      captured: true
    };
  } catch (error) {
    console.error("Error capturing restore evidence:", error);
    return {
      captured: false,
      error: error.message
    };
  }
}

/**
 * Create chain entry for evidence integrity
 */
async function createChainEntry(entryId, entryHash) {
  try {
    // Find previous entry (by timestamp order)
    const prevQuery = `
      SELECT id, evidence_hash FROM evidence_entries
      WHERE id != $1
      ORDER BY event_timestamp DESC
      LIMIT 1
    `;

    const prevResult = await db.pool.query(prevQuery, [entryId]);
    const previousEntryId = prevResult.rows[0]?.id || null;
    const previousHash = prevResult.rows[0]?.evidence_hash || "";

    // Create chain hash
    const chainHashData = `${previousHash}:${entryHash}`;
    const chainHash = crypto
      .createHash("sha256")
      .update(chainHashData)
      .digest("hex");

    const chainQuery = `
      INSERT INTO evidence_chains (
        entry_id, previous_entry_id, chain_hash, chain_valid
      ) VALUES ($1, $2, $3, $4)
    `;

    await db.pool.query(chainQuery, [
      entryId,
      previousEntryId,
      chainHash,
      true
    ]);

    return { chain_created: true, chain_hash: chainHash };
  } catch (error) {
    console.error("Error creating chain entry:", error);
    return { chain_created: false, error: error.message };
  }
}

/**
 * Capture all recent operations from operation_logs as evidence
 */
async function captureRecentOperations(hoursBack = 1) {
  try {
    const query = `
      SELECT * FROM operation_logs
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${hoursBack} hours'
      ORDER BY created_at ASC
    `;

    const operations = await db.pool.query(query);
    const results = [];

    for (const operation of operations.rows) {
      const result = await captureOperationAsEvidence(operation);
      results.push(result);
    }

    return {
      total_captured: results.filter(r => r.captured).length,
      failed: results.filter(r => !r.captured).length,
      results
    };
  } catch (error) {
    console.error("Error capturing recent operations:", error);
    return {
      total_captured: 0,
      error: error.message
    };
  }
}

/**
 * Get evidence entry
 */
async function getEvidenceEntry(entryId) {
  try {
    const query = `
      SELECT ee.*, ec.chain_valid, es.verified as signature_verified
      FROM evidence_entries ee
      LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
      LEFT JOIN evidence_signatures es ON es.entry_id = ee.id AND es.verified = true
      WHERE ee.id = $1
    `;

    const result = await db.pool.query(query, [entryId]);

    if (result.rows.length === 0) {
      return { error: "Entry not found" };
    }

    return result.rows[0];
  } catch (error) {
    console.error("Error getting evidence entry:", error);
    return { error: error.message };
  }
}

/**
 * Query evidence entries
 */
async function queryEvidence(config = {}) {
  const {
    entryType = null,
    componentName = null,
    resourceId = null,
    hoursBack = 24,
    limit = 100
  } = config;

  try {
    let query = `
      SELECT ee.*, ec.chain_valid
      FROM evidence_entries ee
      LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
      WHERE ee.event_timestamp >= CURRENT_TIMESTAMP - INTERVAL '${hoursBack} hours'
    `;

    const params = [];
    let paramIndex = 1;

    if (entryType) {
      query += ` AND ee.entry_type = $${paramIndex++}`;
      params.push(entryType);
    }

    if (componentName) {
      query += ` AND ee.component_name = $${paramIndex++}`;
      params.push(componentName);
    }

    if (resourceId) {
      query += ` AND ee.resource_id = $${paramIndex++}`;
      params.push(resourceId);
    }

    query += ` ORDER BY ee.event_timestamp DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error("Error querying evidence:", error);
    return [];
  }
}

module.exports = {
  captureOperationAsEvidence,
  captureStateChange,
  captureBackupEvidence,
  captureRestoreEvidence,
  createChainEntry,
  captureRecentOperations,
  getEvidenceEntry,
  queryEvidence
};
