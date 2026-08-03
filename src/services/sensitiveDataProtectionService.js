/**
 * Issue #174 PR D: Sensitive Data Protection Service
 *
 * Data encryption, masking, retention policies, PII detection, and compliance audit
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Register data classification level
 */
async function registerDataClassification(classificationName, classificationLevel, config = {}) {
  try {
    const {
      description = "",
      requiresEncryption = true,
      requiresMasking = false,
      requiresAuditLog = true,
      requiresAccessApproval = false,
      requiresTwoFaForAccess = false,
      maximumRetentionDays = null,
      minimumEncryptionStrength = "AES-256"
    } = config;

    const query = `
      INSERT INTO data_classifications (
        classification_name, classification_level, description,
        requires_encryption, requires_masking, requires_audit_log,
        requires_access_approval, requires_twofa_for_access,
        maximum_retention_days, minimum_encryption_strength
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (classification_name)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, classification_name;
    `;

    const result = await db.pool.query(query, [
      classificationName,
      classificationLevel,
      description,
      requiresEncryption,
      requiresMasking,
      requiresAuditLog,
      requiresAccessApproval,
      requiresTwoFaForAccess,
      maximumRetentionDays,
      minimumEncryptionStrength
    ]);

    return {
      registered: true,
      classification_id: result.rows[0].id,
      classification_name: result.rows[0].classification_name
    };
  } catch (error) {
    console.error("Error registering data classification:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Classify a data field with sensitivity level and protection rules
 */
async function classifyDataField(tableName, columnName, classificationId, config = {}) {
  try {
    const {
      organizationId = null,
      maskingPattern = null,
      piiType = null,
      retentionOverrideDays = null,
      encryptionKeyId = null,
      accessRequireApproval = false,
      accessLogAllReads = false,
      accessRedactInAudit = true
    } = config;

    const query = `
      INSERT INTO data_field_classifications (
        table_name, column_name, organization_id, data_classification_id,
        masking_pattern, pii_type, retention_override_days, encryption_key_id,
        access_require_approval, access_log_all_reads, access_redact_in_audit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (table_name, column_name, organization_id)
      DO UPDATE SET data_classification_id = $4
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      tableName,
      columnName,
      organizationId,
      classificationId,
      maskingPattern,
      piiType,
      retentionOverrideDays,
      encryptionKeyId,
      accessRequireApproval,
      accessLogAllReads,
      accessRedactInAudit
    ]);

    return {
      classified: true,
      field_id: result.rows[0].id,
      table_name: tableName,
      column_name: columnName,
      classification_id: classificationId
    };
  } catch (error) {
    console.error("Error classifying data field:", error);
    return { classified: false, error: error.message };
  }
}

/**
 * Register encryption key with rotation schedule
 */
async function registerEncryptionKey(keyName, keyId, keyAlgorithm, config = {}) {
  try {
    const {
      keyType = "data_encryption",
      rotationIntervalDays = 90,
      organizationId = null,
      usesExternalKms = true
    } = config;

    const nextRotation = new Date();
    nextRotation.setDate(nextRotation.getDate() + rotationIntervalDays);

    const query = `
      INSERT INTO encryption_keys (
        key_name, key_id, key_algorithm, key_type,
        rotation_interval_days, next_rotation_at,
        organization_id, uses_external_kms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (key_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, key_name;
    `;

    const result = await db.pool.query(query, [
      keyName,
      keyId,
      keyAlgorithm,
      keyType,
      rotationIntervalDays,
      nextRotation,
      organizationId,
      usesExternalKms
    ]);

    return {
      registered: true,
      key_id: result.rows[0].id,
      key_name: result.rows[0].key_name
    };
  } catch (error) {
    console.error("Error registering encryption key:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Rotate encryption key (mark as retired, create new key)
 */
async function rotateEncryptionKey(currentKeyId, newKeyId, organizationId) {
  try {
    // Mark current key as retired
    await db.pool.query(
      `UPDATE encryption_keys SET is_retired = true
       WHERE key_id = $1 AND organization_id = $2`,
      [currentKeyId, organizationId]
    );

    // Create new key
    const newKeyName = `${currentKeyId}-rotated-${Date.now()}`;
    const query = `
      INSERT INTO encryption_keys (
        key_name, key_id, key_algorithm, key_type,
        rotation_interval_days, next_rotation_at,
        organization_id
      ) SELECT
        $1, $2, key_algorithm, key_type,
        rotation_interval_days,
        CURRENT_TIMESTAMP + (rotation_interval_days || ' days')::INTERVAL,
        organization_id
      FROM encryption_keys
      WHERE key_id = $3 AND organization_id = $4
      RETURNING id, key_name;
    `;

    const result = await db.pool.query(query, [
      newKeyName,
      newKeyId,
      currentKeyId,
      organizationId
    ]);

    return {
      rotated: true,
      new_key_id: result.rows[0]?.id,
      new_key_name: result.rows[0]?.key_name
    };
  } catch (error) {
    console.error("Error rotating encryption key:", error);
    return { rotated: false, error: error.message };
  }
}

/**
 * Register data retention policy
 */
async function registerRetentionPolicy(policyName, tableName, retentionConfig = {}) {
  try {
    const {
      organizationId = null,
      retentionType = "delete",
      retentionDays = 2555,
      retentionTrigger = "creation_date",
      archiveLocation = null,
      archiveAfterDays = null,
      anonymizationMethod = "masking",
      deleteSafely = true,
      requireApprovalForDeletion = false,
      exceptionConditions = null,
      holdOnDeletion = false
    } = retentionConfig;

    const query = `
      INSERT INTO data_retention_policies (
        policy_name, table_name, organization_id, retention_type,
        retention_days, retention_trigger, archive_location, archive_after_days,
        anonymization_method, delete_safely, require_approval_for_deletion,
        exception_conditions, hold_on_deletion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (policy_name)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, policy_name;
    `;

    const result = await db.pool.query(query, [
      policyName,
      tableName,
      organizationId,
      retentionType,
      retentionDays,
      retentionTrigger,
      archiveLocation,
      archiveAfterDays,
      anonymizationMethod,
      deleteSafely,
      requireApprovalForDeletion,
      JSON.stringify(exceptionConditions),
      holdOnDeletion
    ]);

    return {
      registered: true,
      policy_id: result.rows[0].id,
      policy_name: result.rows[0].policy_name
    };
  } catch (error) {
    console.error("Error registering retention policy:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Register PII detection rule
 */
async function registerPiiDetectionRule(piiType, detectionPattern, config = {}) {
  try {
    const {
      ruleName = piiType,
      description = "",
      patternExamples = null,
      maskingPattern = null,
      maskingExamples = null,
      defaultClassificationLevel = 4,
      requiresEncryption = true,
      requiresAccessApproval = false
    } = config;

    const query = `
      INSERT INTO pii_detection_rules (
        rule_name, pii_type, description, detection_pattern,
        pattern_examples, masking_pattern, masking_examples,
        default_classification_level, requires_encryption,
        requires_access_approval
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (pii_type)
      DO UPDATE SET detection_pattern = $4
      RETURNING id, pii_type;
    `;

    const result = await db.pool.query(query, [
      ruleName,
      piiType,
      description,
      detectionPattern,
      JSON.stringify(patternExamples),
      maskingPattern,
      JSON.stringify(maskingExamples),
      defaultClassificationLevel,
      requiresEncryption,
      requiresAccessApproval
    ]);

    return {
      registered: true,
      rule_id: result.rows[0].id,
      pii_type: result.rows[0].pii_type
    };
  } catch (error) {
    console.error("Error registering PII detection rule:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Register data masking rule
 */
async function registerMaskingRule(tableName, columnName, maskingMethod, config = {}) {
  try {
    const {
      ruleName = `${tableName}_${columnName}_mask`,
      maskingPattern = null,
      applyToContexts = ["logs", "exports"],
      applyByRole = {}
    } = config;

    const query = `
      INSERT INTO data_masking_rules (
        rule_name, table_name, column_name, masking_method,
        masking_pattern, apply_to_contexts, apply_by_role
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (table_name, column_name)
      DO UPDATE SET masking_method = $4
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      ruleName,
      tableName,
      columnName,
      maskingMethod,
      maskingPattern,
      JSON.stringify(applyToContexts),
      JSON.stringify(applyByRole)
    ]);

    return {
      registered: true,
      rule_id: result.rows[0].id,
      table_name: tableName,
      column_name: columnName
    };
  } catch (error) {
    console.error("Error registering masking rule:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Log data access for audit trail
 */
async function logDataAccess(userId, organizationId, accessConfig = {}) {
  try {
    const {
      accessType = "read",
      tableName = null,
      recordId = null,
      columnName = null,
      affectedPiiTypes = null,
      accessMethod = "api",
      requestId = null,
      ipAddress = null,
      userAgent = null,
      flaggedForReview = false,
      accessApproved = true
    } = accessConfig;

    const query = `
      INSERT INTO data_access_log (
        user_id, organization_id, access_type, table_name, record_id,
        column_name, affected_pii_types, access_method, request_id,
        ip_address, user_agent, flagged_for_review, access_approved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      accessType,
      tableName,
      recordId,
      columnName,
      JSON.stringify(affectedPiiTypes),
      accessMethod,
      requestId,
      ipAddress,
      userAgent,
      flaggedForReview,
      accessApproved
    ]);

    return {
      logged: true,
      access_log_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error logging data access:", error);
    return { logged: false, error: error.message };
  }
}

/**
 * Log encrypted data for key tracking
 */
async function logEncryptedData(tableName, recordId, columnName, encryptionKeyId, organizationId, config = {}) {
  try {
    const {
      encryptionAlgorithm = "AES-256-GCM",
      dataClassificationId = null,
      piiType = null
    } = config;

    // Calculate data hash for tamper detection
    const dataHash = crypto
      .createHash("sha256")
      .update(`${tableName}:${recordId}:${columnName}:${Date.now()}`)
      .digest("hex");

    const query = `
      INSERT INTO encrypted_data_log (
        table_name, record_id, column_name, encryption_key_id,
        encryption_algorithm, data_hash, data_classification_id,
        pii_type, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      tableName,
      recordId,
      columnName,
      encryptionKeyId,
      encryptionAlgorithm,
      dataHash,
      dataClassificationId,
      piiType,
      organizationId
    ]);

    return {
      logged: true,
      encryption_log_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error logging encrypted data:", error);
    return { logged: false, error: error.message };
  }
}

/**
 * Track data export with PII information
 */
async function trackDataExport(userId, organizationId, exportConfig = {}) {
  try {
    const {
      exportType = "csv",
      tableNames = [],
      recordCount = 0,
      piiTypesIncluded = null,
      exportMethod = "direct_download",
      destination = null,
      includesEncryptedData = false,
      includesMaskedData = true,
      exportedDataRedacted = true,
      approvalId = null
    } = exportConfig;

    const fileHash = crypto
      .createHash("sha256")
      .update(`${userId}:${Date.now()}:${recordCount}`)
      .digest("hex");

    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() + 90); // 90-day retention

    const query = `
      INSERT INTO data_export_log (
        export_id, user_id, organization_id, export_type, table_names,
        record_count, pii_types_included, export_method, destination,
        file_hash, includes_encrypted_data, includes_masked_data,
        exported_data_redacted, approval_id, retention_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING export_id;
    `;

    const result = await db.pool.query(query, [
      `export-${crypto.randomUUID()}`,
      userId,
      organizationId,
      exportType,
      JSON.stringify(tableNames),
      recordCount,
      JSON.stringify(piiTypesIncluded),
      exportMethod,
      destination,
      fileHash,
      includesEncryptedData,
      includesMaskedData,
      exportedDataRedacted,
      approvalId,
      retentionDate
    ]);

    return {
      tracked: true,
      export_id: result.rows[0].export_id
    };
  } catch (error) {
    console.error("Error tracking data export:", error);
    return { tracked: false, error: error.message };
  }
}

/**
 * Report data breach incident
 */
async function reportDataBreach(organizationId, incidentName, breachConfig = {}) {
  try {
    const {
      breachType = "unauthorized_access",
      affectedTables = [],
      affectedRecordsCount = 0,
      affectedPiiTypes = null,
      immediateActions = {},
      severity = "high"
    } = breachConfig;

    const query = `
      INSERT INTO data_breach_incidents (
        incident_name, organization_id, breach_type,
        affected_tables, affected_records_count, affected_pii_types,
        immediate_actions, status, severity_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, incident_name;
    `;

    const result = await db.pool.query(query, [
      incidentName,
      organizationId,
      breachType,
      JSON.stringify(affectedTables),
      affectedRecordsCount,
      JSON.stringify(affectedPiiTypes),
      JSON.stringify(immediateActions),
      "detected",
      severity
    ]);

    return {
      reported: true,
      breach_id: result.rows[0].id,
      incident_name: result.rows[0].incident_name
    };
  } catch (error) {
    console.error("Error reporting data breach:", error);
    return { reported: false, error: error.message };
  }
}

/**
 * Update breach status and track remediation
 */
async function updateBreachStatus(breachId, status, config = {}) {
  try {
    const {
      investigationFindings = null,
      rootCause = null,
      remediationPlan = null,
      remediationComplete = false,
      usersNotified = false,
      regulatorsNotified = false
    } = config;

    const query = `
      UPDATE data_breach_incidents
      SET status = $2, investigation_findings = $3, root_cause = $4,
          remediation_plan = $5, remediation_complete = $6,
          users_notified = $7, regulators_notified = $8,
          status_updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, status;
    `;

    const result = await db.pool.query(query, [
      breachId,
      status,
      investigationFindings,
      rootCause,
      remediationPlan,
      remediationComplete,
      usersNotified,
      regulatorsNotified
    ]);

    if (result.rows.length === 0) {
      return { updated: false, reason: "breach_not_found" };
    }

    return {
      updated: true,
      breach_id: breachId,
      new_status: result.rows[0].status
    };
  } catch (error) {
    console.error("Error updating breach status:", error);
    return { updated: false, error: error.message };
  }
}

/**
 * Get data protection summary
 */
async function getDataProtectionSummary() {
  try {
    const query = `SELECT * FROM data_protection_summary`;
    const result = await db.pool.query(query);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting data protection summary:", error);
    return { error: error.message };
  }
}

/**
 * Get encryption key status report
 */
async function getEncryptionKeyStatusReport() {
  try {
    const query = `SELECT * FROM encryption_key_status`;
    const result = await db.pool.query(query);

    return {
      key_status: result.rows
    };
  } catch (error) {
    console.error("Error getting encryption key status:", error);
    return { error: error.message };
  }
}

/**
 * Get recent data access summary
 */
async function getRecentDataAccessSummary() {
  try {
    const query = `SELECT * FROM recent_data_access_summary`;
    const result = await db.pool.query(query);

    return {
      access_summary: result.rows
    };
  } catch (error) {
    console.error("Error getting data access summary:", error);
    return { error: error.message };
  }
}

/**
 * Get PII exposure summary
 */
async function getPiiExposureSummary() {
  try {
    const query = `SELECT * FROM pii_exposure_summary`;
    const result = await db.pool.query(query);

    return {
      pii_exposure: result.rows
    };
  } catch (error) {
    console.error("Error getting PII exposure summary:", error);
    return { error: error.message };
  }
}

/**
 * Get data classification for field
 */
async function getFieldClassification(tableName, columnName, organizationId = null) {
  try {
    const query = `
      SELECT dfc.*, dc.classification_name, dc.classification_level
      FROM data_field_classifications dfc
      JOIN data_classifications dc ON dc.id = dfc.data_classification_id
      WHERE dfc.table_name = $1 AND dfc.column_name = $2
      AND (dfc.organization_id = $3 OR dfc.organization_id IS NULL)
      ORDER BY dfc.organization_id DESC NULLS LAST
      LIMIT 1
    `;

    const result = await db.pool.query(query, [tableName, columnName, organizationId]);

    if (result.rows.length === 0) {
      return { classified: false };
    }

    return {
      classified: true,
      classification: result.rows[0]
    };
  } catch (error) {
    console.error("Error getting field classification:", error);
    return { classified: false, error: error.message };
  }
}

/**
 * Get retention policy for table
 */
async function getRetentionPolicy(tableName, organizationId = null) {
  try {
    const query = `
      SELECT * FROM data_retention_policies
      WHERE table_name = $1 AND is_active = true
      AND (organization_id = $2 OR organization_id IS NULL)
      ORDER BY organization_id DESC NULLS LAST
      LIMIT 1
    `;

    const result = await db.pool.query(query, [tableName, organizationId]);

    if (result.rows.length === 0) {
      return { found: false };
    }

    return {
      found: true,
      policy: result.rows[0]
    };
  } catch (error) {
    console.error("Error getting retention policy:", error);
    return { found: false, error: error.message };
  }
}

/**
 * Detect PII in text using registered rules
 */
async function detectPiiInText(text, organizationId = null) {
  try {
    const rules = await db.pool.query(
      `SELECT pii_type, detection_pattern FROM pii_detection_rules WHERE is_active = true`
    );

    const detectedPii = [];

    for (const rule of rules.rows) {
      const pattern = new RegExp(rule.detection_pattern, "gi");
      if (pattern.test(text)) {
        detectedPii.push(rule.pii_type);
      }
    }

    return {
      detected: detectedPii.length > 0,
      pii_types: detectedPii
    };
  } catch (error) {
    console.error("Error detecting PII:", error);
    return { detected: false, error: error.message };
  }
}

/**
 * Apply masking rule to value
 */
async function applyMasking(tableName, columnName, value) {
  try {
    const query = `
      SELECT masking_method, masking_pattern FROM data_masking_rules
      WHERE table_name = $1 AND column_name = $2 AND is_active = true
      LIMIT 1
    `;

    const result = await db.pool.query(query, [tableName, columnName]);

    if (result.rows.length === 0) {
      return { masked: false, masked_value: value };
    }

    const rule = result.rows[0];
    let maskedValue = value;

    switch (rule.masking_method) {
      case "full_redact":
        maskedValue = "***REDACTED***";
        break;
      case "partial_redact":
        if (rule.masking_pattern) {
          maskedValue = value.replace(/./g, (char, index) => {
            return rule.masking_pattern.includes(index) ? "*" : char;
          });
        }
        break;
      case "hash":
        maskedValue = crypto.createHash("sha256").update(value).digest("hex").substring(0, 16);
        break;
      case "null":
        maskedValue = null;
        break;
      default:
        maskedValue = value;
    }

    return {
      masked: true,
      masked_value: maskedValue,
      masking_method: rule.masking_method
    };
  } catch (error) {
    console.error("Error applying masking:", error);
    return { masked: false, masked_value: value, error: error.message };
  }
}

module.exports = {
  registerDataClassification,
  classifyDataField,
  registerEncryptionKey,
  rotateEncryptionKey,
  registerRetentionPolicy,
  registerPiiDetectionRule,
  registerMaskingRule,
  logDataAccess,
  logEncryptedData,
  trackDataExport,
  reportDataBreach,
  updateBreachStatus,
  getDataProtectionSummary,
  getEncryptionKeyStatusReport,
  getRecentDataAccessSummary,
  getPiiExposureSummary,
  getFieldClassification,
  getRetentionPolicy,
  detectPiiInText,
  applyMasking
};
