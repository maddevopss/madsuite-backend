/**
 * Issue #173 PR H: Compliance Reporting Service
 *
 * Generate audit trails, compliance certificates, and forensic reports
 * Support litigation holds, chain of custody verification, and evidence export
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Generate complete audit trail for compliance
 */
async function generateAuditTrail(startDate, endDate) {
  try {
    const query = `
      SELECT
        ee.id,
        ee.entry_type,
        ee.component_name,
        ee.resource_type,
        ee.resource_id,
        ee.action,
        ee.status,
        ee.initiator_user_id,
        ee.initiator_reason,
        ee.event_timestamp,
        ee.recorded_at,
        ec.chain_valid,
        ec.chain_verified_at,
        es.verified as signature_verified,
        es.signer_id,
        ee.on_hold,
        COUNT(*) OVER (PARTITION BY ee.component_name ORDER BY ee.event_timestamp) as component_sequence
      FROM evidence_entries ee
      LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
      LEFT JOIN evidence_signatures es ON es.entry_id = ee.id
      WHERE ee.event_timestamp >= $1 AND ee.event_timestamp <= $2
      ORDER BY ee.event_timestamp ASC
    `;

    const result = await db.pool.query(query, [startDate, endDate]);

    // Calculate audit statistics
    const stats = {
      total_entries: result.rows.length,
      by_type: {},
      by_component: {},
      by_status: {},
      chain_integrity: {
        valid: 0,
        invalid: 0,
        unverified: 0
      },
      signature_coverage: {
        signed: 0,
        unsigned: 0
      }
    };

    result.rows.forEach(row => {
      stats.by_type[row.entry_type] = (stats.by_type[row.entry_type] || 0) + 1;
      stats.by_component[row.component_name] = (stats.by_component[row.component_name] || 0) + 1;
      stats.by_status[row.status] = (stats.by_status[row.status] || 0) + 1;

      if (row.chain_valid === true) stats.chain_integrity.valid += 1;
      else if (row.chain_valid === false) stats.chain_integrity.invalid += 1;
      else stats.chain_integrity.unverified += 1;

      if (row.signature_verified) stats.signature_coverage.signed += 1;
      else stats.signature_coverage.unsigned += 1;
    });

    return {
      audit_period: { start: startDate, end: endDate },
      statistics: stats,
      entries: result.rows,
      generated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error generating audit trail:", error);
    return { error: error.message };
  }
}

/**
 * Generate compliance certificate (attestation of chain validity)
 */
async function generateComplianceCertificate(reportType = "chain_integrity", config = {}) {
  try {
    const {
      startDate,
      endDate,
      verifyingOfficer = "compliance@company.com",
      jurisdiction = "general"
    } = config;

    // Get verification data
    let verificationData = {};
    let certificateData = {};

    switch (reportType) {
      case "chain_integrity":
        {
          const query = `
            SELECT
              COUNT(*) as total_entries,
              COUNT(CASE WHEN ec.chain_valid = true THEN 1 END) as valid_count,
              COUNT(CASE WHEN ec.chain_valid = false THEN 1 END) as invalid_count,
              COUNT(CASE WHEN ec.chain_valid IS NULL THEN 1 END) as unverified_count
            FROM evidence_entries ee
            LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
            WHERE ee.event_timestamp >= $1 AND ee.event_timestamp <= $2
          `;

          const result = await db.pool.query(query, [startDate, endDate]);
          verificationData = result.rows[0];

          certificateData = {
            certificate_type: "CHAIN_INTEGRITY_ATTESTATION",
            verified_entries: verificationData.valid_count,
            total_entries: verificationData.total_entries,
            integrity_percentage: ((verificationData.valid_count / verificationData.total_entries) * 100).toFixed(2),
            all_valid: verificationData.invalid_count === 0
          };
        }
        break;

      case "evidence_completeness":
        {
          const query = `
            SELECT
              (SELECT COUNT(*) FROM operation_logs WHERE created_at >= $1 AND created_at <= $2) as expected_entries,
              (SELECT COUNT(*) FROM evidence_entries WHERE event_timestamp >= $1 AND event_timestamp <= $2) as captured_entries
          `;

          const result = await db.pool.query(query, [startDate, endDate]);
          const data = result.rows[0];

          certificateData = {
            certificate_type: "EVIDENCE_COMPLETENESS_ATTESTATION",
            expected_entries: data.expected_entries,
            captured_entries: data.captured_entries,
            coverage_percentage: ((data.captured_entries / data.expected_entries) * 100).toFixed(2),
            complete: data.captured_entries >= data.expected_entries
          };
        }
        break;

      case "no_tampering":
        {
          const query = `
            SELECT
              COUNT(*) as total_entries,
              COUNT(CASE WHEN ec.chain_valid = false THEN 1 END) as tampered_count,
              COUNT(CASE WHEN ec.chain_valid = true THEN 1 END) as valid_count
            FROM evidence_entries ee
            LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
            WHERE ee.event_timestamp >= $1 AND ee.event_timestamp <= $2
          `;

          const result = await db.pool.query(query, [startDate, endDate]);
          const data = result.rows[0];

          certificateData = {
            certificate_type: "NO_TAMPERING_ATTESTATION",
            total_entries: data.total_entries,
            tampered_count: data.tampered_count,
            valid_count: data.valid_count,
            no_tampering_detected: data.tampered_count === 0
          };
        }
        break;
    }

    // Generate certificate ID and signature
    const certificateId = crypto.randomBytes(16).toString("hex");
    const certificateData_str = JSON.stringify(certificateData);
    const certificateSignature = crypto
      .createHash("sha256")
      .update(certificateData_str + certificateId)
      .digest("hex");

    return {
      certificate_id: certificateId,
      report_type: reportType,
      certificate_data: certificateData,
      jurisdiction,
      verifying_officer: verifyingOfficer,
      certificate_signature: certificateSignature,
      issued_at: new Date().toISOString(),
      valid_for_days: 90
    };
  } catch (error) {
    console.error("Error generating compliance certificate:", error);
    return { error: error.message };
  }
}

/**
 * Generate user access report
 */
async function generateAccessReport(userId, dateRange = null) {
  try {
    let query = `
      SELECT
        eal.accessed_entry_id,
        eal.accessor_user_id,
        eal.access_type,
        eal.access_granted,
        eal.accessed_at,
        ee.entry_type,
        ee.component_name,
        ee.resource_id,
        ee.initiator_user_id as evidence_initiator
      FROM evidence_access_log eal
      JOIN evidence_entries ee ON ee.id = eal.accessed_entry_id
      WHERE eal.accessor_user_id = $1
    `;

    const params = [userId];

    if (dateRange && dateRange.start && dateRange.end) {
      query += ` AND eal.accessed_at >= $2 AND eal.accessed_at <= $3`;
      params.push(dateRange.start, dateRange.end);
    }

    query += ` ORDER BY eal.accessed_at DESC`;

    const result = await db.pool.query(query, params);

    // Calculate statistics
    const stats = {
      total_accesses: result.rows.length,
      granted: result.rows.filter(r => r.access_granted).length,
      denied: result.rows.filter(r => !r.access_granted).length,
      by_type: {},
      by_component: {},
      unique_entries_accessed: new Set(result.rows.map(r => r.accessed_entry_id)).size
    };

    result.rows.forEach(row => {
      stats.by_type[row.access_type] = (stats.by_type[row.access_type] || 0) + 1;
      stats.by_component[row.component_name] = (stats.by_component[row.component_name] || 0) + 1;
    });

    return {
      user_id: userId,
      date_range: dateRange,
      statistics: stats,
      accesses: result.rows,
      generated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error generating access report:", error);
    return { error: error.message };
  }
}

/**
 * Generate tampering incident report
 */
async function generateTamperingReport(startDate, endDate) {
  try {
    const query = `
      SELECT
        ee.id,
        ee.entry_type,
        ee.component_name,
        ee.event_timestamp,
        ee.evidence_hash,
        ec.chain_hash,
        ec.chain_valid,
        ec.chain_verified_at
      FROM evidence_entries ee
      LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
      WHERE ec.chain_valid = false
        AND ee.event_timestamp >= $1
        AND ee.event_timestamp <= $2
      ORDER BY ee.event_timestamp DESC
    `;

    const result = await db.pool.query(query, [startDate, endDate]);

    // Organize by severity
    const incidents = result.rows.map(row => ({
      entry_id: row.id,
      entry_type: row.entry_type,
      component_name: row.component_name,
      detected_at: row.chain_verified_at || new Date().toISOString(),
      event_timestamp: row.event_timestamp,
      severity: "CRITICAL",
      reason: "chain_integrity_violated"
    }));

    return {
      report_period: { start: startDate, end: endDate },
      incident_count: incidents.length,
      incidents,
      summary: {
        critical: incidents.length,
        requires_investigation: incidents.length > 0,
        recommendation: incidents.length > 0 ? "Immediate investigation required. Affected entries cannot be used in legal proceedings." : "No tampering detected."
      },
      generated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error generating tampering report:", error);
    return { error: error.message };
  }
}

/**
 * Export evidence for litigation
 */
async function exportForLitigation(startDate, endDate, affectedResources = {}) {
  try {
    const { componentNames = [], resourceTypes = [], resourceIds = [] } = affectedResources;

    let query = `
      SELECT
        ee.id,
        ee.entry_type,
        ee.component_name,
        ee.resource_type,
        ee.resource_id,
        ee.action,
        ee.status,
        ee.initiator_user_id,
        ee.initiator_reason,
        ee.metadata,
        ee.before_state,
        ee.after_state,
        ee.event_timestamp,
        ee.recorded_at,
        ec.chain_valid,
        ec.chain_hash,
        es.verified as signature_verified,
        ch.hold_id
      FROM evidence_entries ee
      LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
      LEFT JOIN evidence_signatures es ON es.entry_id = ee.id
      LEFT JOIN compliance_holds ch ON ee.hold_id = ch.id
      WHERE ee.event_timestamp >= $1 AND ee.event_timestamp <= $2
    `;

    const params = [startDate, endDate];
    let paramIndex = 3;

    if (componentNames.length > 0) {
      query += ` AND ee.component_name = ANY($${paramIndex++})`;
      params.push(componentNames);
    }

    if (resourceTypes.length > 0) {
      query += ` AND ee.resource_type = ANY($${paramIndex++})`;
      params.push(resourceTypes);
    }

    if (resourceIds.length > 0) {
      query += ` AND ee.resource_id = ANY($${paramIndex++})`;
      params.push(resourceIds);
    }

    query += ` ORDER BY ee.event_timestamp ASC`;

    const result = await db.pool.query(query, params);

    // Generate litigation export bundle
    const exportId = crypto.randomBytes(16).toString("hex");
    const exportData = {
      entries: result.rows,
      metadata: {
        total_entries: result.rows.length,
        date_range: { start: startDate, end: endDate },
        affected_resources: affectedResources,
        chain_integrity: {
          all_valid: result.rows.every(r => r.chain_valid !== false),
          tampered_count: result.rows.filter(r => r.chain_valid === false).length
        },
        signature_coverage: {
          signed: result.rows.filter(r => r.signature_verified).length,
          unsigned: result.rows.filter(r => !r.signature_verified).length
        }
      }
    };

    // Store export record
    const exportQuery = `
      INSERT INTO evidence_archival (
        archive_date, entry_count, archive_location, retention_category,
        checksum, entries_archived, archived_by, archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      RETURNING id;
    `;

    const checksum = crypto
      .createHash("sha256")
      .update(JSON.stringify(exportData.entries))
      .digest("hex");

    const exportResult = await db.pool.query(exportQuery, [
      new Date().toISOString().split("T")[0],
      result.rows.length,
      `litigation-export://${exportId}`,
      "litigation_hold",
      checksum,
      JSON.stringify(result.rows.map(r => r.id)),
      "litigation_team"
    ]);

    return {
      export_id: exportId,
      export_archive_id: exportResult.rows[0].id,
      entry_count: result.rows.length,
      chain_integrity_all_valid: exportData.metadata.chain_integrity.all_valid,
      tampered_entries: exportData.metadata.chain_integrity.tampered_count,
      signed_entries: exportData.metadata.signature_coverage.signed,
      unsigned_entries: exportData.metadata.signature_coverage.unsigned,
      checksum,
      exported_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error exporting for litigation:", error);
    return { error: error.message };
  }
}

/**
 * Verify chain of custody for evidence
 */
async function verifyChainOfCustody(entryId) {
  try {
    const entryQuery = `
      SELECT
        ee.id,
        ee.entry_type,
        ee.event_timestamp,
        ee.recorded_at,
        ec.chain_valid,
        ec.chain_verified_at,
        es.verified as signature_verified,
        es.signed_at,
        es.signer_id
      FROM evidence_entries ee
      LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
      LEFT JOIN evidence_signatures es ON es.entry_id = ee.id
      WHERE ee.id = $1
    `;

    const entryResult = await db.pool.query(entryQuery, [entryId]);

    if (entryResult.rows.length === 0) {
      return { verified: false, reason: "entry_not_found" };
    }

    const entry = entryResult.rows[0];

    // Get full access history
    const accessQuery = `
      SELECT
        id,
        accessor_user_id,
        access_type,
        access_granted,
        accessed_at,
        ip_address
      FROM evidence_access_log
      WHERE accessed_entry_id = $1
      ORDER BY accessed_at ASC
    `;

    const accessResult = await db.pool.query(accessQuery, [entryId]);

    const chainValid = entry.chain_valid === true;
    const signed = entry.signature_verified === true;
    const allAccessesGranted = accessResult.rows.every(r => r.access_granted);

    return {
      entry_id: entryId,
      chain_of_custody_valid: chainValid && signed && allAccessesGranted,
      entry_data: {
        recorded_at: entry.recorded_at,
        event_timestamp: entry.event_timestamp,
        chain_valid: chainValid,
        signature_valid: signed,
        signer_id: entry.signer_id
      },
      access_history: accessResult.rows,
      custody_checks: {
        chain_integrity: chainValid ? "PASS" : "FAIL",
        signature: signed ? "PASS" : "FAIL",
        access_control: allAccessesGranted ? "PASS" : "FAIL"
      },
      verified_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error verifying chain of custody:", error);
    return { verified: false, error: error.message };
  }
}

module.exports = {
  generateAuditTrail,
  generateComplianceCertificate,
  generateAccessReport,
  generateTamperingReport,
  exportForLitigation,
  verifyChainOfCustody
};
