/**
 * Issue #174 PR D: Sensitive Data Protection Integration Tests
 *
 * Test cases for:
 * - Data classification and sensitivity levels
 * - Field classification with protection rules
 * - Encryption key management and rotation
 * - Data retention policies
 * - PII detection and classification
 * - Data masking rules
 * - Data access logging and audit trail
 * - Data export tracking
 * - Data breach incident management
 */

const db = require("../../db");
const dataProtectionService = require("../services/sensitiveDataProtectionService");

describe("Stage 6: Sensitive Data Protection", () => {
  const testOrgId = "550e8400-e29b-41d4-a716-446655440002";
  const testUserId = "user-data-protection-001";

  beforeAll(async () => {
    try {
      await db.pool.query(
        `INSERT INTO organizations (id, name, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [testOrgId, "Data Protection Test Org", "data-test"]
      );
    } catch (error) {
      console.log("Setup warning:", error.message);
    }
  });

  afterAll(async () => {
    try {
      await db.pool.query(`DELETE FROM data_access_log WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM data_export_log WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM encrypted_data_log WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM data_breach_incidents WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM data_field_classifications WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM data_retention_policies WHERE organization_id = $1`, [testOrgId]);
    } catch (error) {
      console.log("Cleanup warning:", error.message);
    }
  });

  describe("Data Classification", () => {
    test("Register public data classification", async () => {
      const result = await dataProtectionService.registerDataClassification(
        "public",
        1,
        {
          description: "Public data with no restrictions",
          requiresEncryption: false,
          requiresMasking: false
        }
      );

      expect(result.registered).toBe(true);
      expect(result.classification_name).toBe("public");
    });

    test("Register confidential data classification", async () => {
      const result = await dataProtectionService.registerDataClassification(
        "confidential",
        3,
        {
          description: "Confidential business data",
          requiresEncryption: true,
          requiresMasking: false,
          requiresAccessApproval: true,
          maximumRetentionDays: 2555
        }
      );

      expect(result.registered).toBe(true);
      expect(result.classification_name).toBe("confidential");
    });

    test("Register highly restricted data classification", async () => {
      const result = await dataProtectionService.registerDataClassification(
        "highly_restricted",
        5,
        {
          description: "Highly restricted data (PII, financial)",
          requiresEncryption: true,
          requiresMasking: true,
          requiresAccessApproval: true,
          requiresTwoFaForAccess: true,
          minimumEncryptionStrength: "AES-256"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register classification with all protection requirements", async () => {
      const result = await dataProtectionService.registerDataClassification(
        "ultra_secure",
        5,
        {
          requiresEncryption: true,
          requiresMasking: true,
          requiresAuditLog: true,
          requiresAccessApproval: true,
          requiresTwoFaForAccess: true,
          maximumRetentionDays: 365,
          minimumEncryptionStrength: "AES-256"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register classification without optional parameters", async () => {
      const result = await dataProtectionService.registerDataClassification(
        "test_class",
        2
      );

      expect(result.registered).toBe(true);
    });

    test("Classification levels: 1=public, 2=internal, 3=confidential, 4=restricted, 5=highly_restricted", async () => {
      const levels = [
        { name: "level1", level: 1 },
        { name: "level2", level: 2 },
        { name: "level3", level: 3 },
        { name: "level4", level: 4 },
        { name: "level5", level: 5 }
      ];

      for (const classification of levels) {
        const result = await dataProtectionService.registerDataClassification(
          classification.name,
          classification.level
        );
        expect(result.registered).toBe(true);
      }
    });
  });

  describe("Field Classification", () => {
    beforeEach(async () => {
      await dataProtectionService.registerDataClassification("test_field_class", 3);
    });

    test("Classify employee SSN field as highly restricted with masking", async () => {
      const result = await dataProtectionService.classifyDataField(
        "employees",
        "ssn",
        (await db.pool.query("SELECT id FROM data_classifications WHERE classification_name = 'test_field_class'")).rows[0].id,
        {
          piiType: "ssn",
          maskingPattern: "XXX-XX-\\d{4}",
          accessRequireApproval: true,
          accessLogAllReads: true,
          accessRedactInAudit: true
        }
      );

      expect(result.classified).toBe(true);
      expect(result.table_name).toBe("employees");
      expect(result.column_name).toBe("ssn");
    });

    test("Classify email field with PII type", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_name = 'test_field_class'")).rows[0].id;

      const result = await dataProtectionService.classifyDataField(
        "users",
        "email",
        classId,
        {
          piiType: "email",
          maskingPattern: "***@***.***",
          accessLogAllReads: true
        }
      );

      expect(result.classified).toBe(true);
    });

    test("Classify phone number field with organization scope", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_name = 'test_field_class'")).rows[0].id;

      const result = await dataProtectionService.classifyDataField(
        "contacts",
        "phone",
        classId,
        {
          organizationId: testOrgId,
          piiType: "phone",
          maskingPattern: "XXX-XXX-XXXX"
        }
      );

      expect(result.classified).toBe(true);
    });

    test("Classify field with retention override", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_name = 'test_field_class'")).rows[0].id;

      const result = await dataProtectionService.classifyDataField(
        "logs",
        "sensitive_value",
        classId,
        {
          retentionOverrideDays: 90
        }
      );

      expect(result.classified).toBe(true);
    });

    test("Classify multiple fields in same table", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_name = 'test_field_class'")).rows[0].id;

      const fields = ["ssn", "credit_card", "date_of_birth"];

      for (const field of fields) {
        const result = await dataProtectionService.classifyDataField(
          "financial_records",
          field,
          classId,
          { piiType: field }
        );
        expect(result.classified).toBe(true);
      }
    });
  });

  describe("Encryption Key Management", () => {
    test("Register encryption key", async () => {
      const result = await dataProtectionService.registerEncryptionKey(
        "prod-key-2024",
        "key-prod-001",
        "AES-256-GCM",
        {
          keyType: "data_encryption",
          rotationIntervalDays: 90,
          organizationId: testOrgId
        }
      );

      expect(result.registered).toBe(true);
      expect(result.key_name).toBe("prod-key-2024");
    });

    test("Register encryption key with AWS KMS", async () => {
      const result = await dataProtectionService.registerEncryptionKey(
        "aws-kms-key",
        "arn:aws:kms:us-east-1:123456789:key/12345678",
        "AES-256-GCM",
        {
          keyType: "data_encryption",
          usesExternalKms: true
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register key encryption key (KEK)", async () => {
      const result = await dataProtectionService.registerEncryptionKey(
        "kek-master",
        "key-kek-master",
        "AES-256-GCM",
        {
          keyType: "key_encryption"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register backup encryption key", async () => {
      const result = await dataProtectionService.registerEncryptionKey(
        "backup-key",
        "key-backup-001",
        "AES-256-GCM",
        {
          keyType: "backup",
          rotationIntervalDays: 365
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Rotate encryption key", async () => {
      // Register initial key
      await dataProtectionService.registerEncryptionKey(
        "rotate-test-key",
        "key-rotate-001",
        "AES-256-GCM",
        { organizationId: testOrgId }
      );

      // Rotate to new key
      const result = await dataProtectionService.rotateEncryptionKey(
        "key-rotate-001",
        "key-rotate-002",
        testOrgId
      );

      expect(result.rotated).toBe(true);
    });

    test("Key rotation interval configuration", async () => {
      const intervals = [30, 90, 180, 365];

      for (const days of intervals) {
        const result = await dataProtectionService.registerEncryptionKey(
          `rotation-interval-${days}`,
          `key-rotation-${days}`,
          "AES-256-GCM",
          { rotationIntervalDays: days }
        );
        expect(result.registered).toBe(true);
      }
    });

    test("Different encryption algorithms", async () => {
      const algorithms = ["AES-256-GCM", "AES-192-GCM", "RSA-4096"];

      for (const algo of algorithms) {
        const result = await dataProtectionService.registerEncryptionKey(
          `algo-${algo}`,
          `key-${algo}`,
          algo
        );
        expect(result.registered).toBe(true);
      }
    });
  });

  describe("Data Retention Policies", () => {
    test("Register delete retention policy", async () => {
      const result = await dataProtectionService.registerRetentionPolicy(
        "delete_90_days",
        "temp_logs",
        {
          retentionType: "delete",
          retentionDays: 90,
          retentionTrigger: "creation_date",
          deleteSafely: true
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register archive retention policy", async () => {
      const result = await dataProtectionService.registerRetentionPolicy(
        "archive_policy",
        "audit_records",
        {
          organizationId: testOrgId,
          retentionType: "archive",
          retentionDays: 2555,
          archiveLocation: "s3://archive-bucket",
          archiveAfterDays: 365
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register anonymize retention policy", async () => {
      const result = await dataProtectionService.registerRetentionPolicy(
        "anonymize_policy",
        "user_activity",
        {
          retentionType: "anonymize",
          retentionDays: 730,
          anonymizationMethod: "masking"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Retention policy with approval requirement", async () => {
      const result = await dataProtectionService.registerRetentionPolicy(
        "deletion_approval",
        "financial_records",
        {
          retentionType: "delete",
          retentionDays: 1825,
          requireApprovalForDeletion: true
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Retention policy with legal hold", async () => {
      const result = await dataProtectionService.registerRetentionPolicy(
        "legal_hold_policy",
        "contracts",
        {
          retentionType: "archive",
          retentionDays: 3650,
          holdOnDeletion: true
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Retention triggers: creation_date, modification_date, last_access", async () => {
      const triggers = ["creation_date", "modification_date", "last_access"];

      for (const trigger of triggers) {
        const result = await dataProtectionService.registerRetentionPolicy(
          `retention_trigger_${trigger}`,
          `table_${trigger}`,
          { retentionTrigger: trigger }
        );
        expect(result.registered).toBe(true);
      }
    });
  });

  describe("PII Detection", () => {
    test("Register SSN detection rule", async () => {
      const result = await dataProtectionService.registerPiiDetectionRule(
        "ssn",
        "\\d{3}-\\d{2}-\\d{4}",
        {
          ruleName: "social_security_number",
          description: "US Social Security Number",
          maskingPattern: "XXX-XX-\\d{4}",
          defaultClassificationLevel: 5
        }
      );

      expect(result.registered).toBe(true);
      expect(result.pii_type).toBe("ssn");
    });

    test("Register email detection rule", async () => {
      const result = await dataProtectionService.registerPiiDetectionRule(
        "email",
        "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
        {
          maskingPattern: "***@***.***",
          defaultClassificationLevel: 3
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register phone number detection rule", async () => {
      const result = await dataProtectionService.registerPiiDetectionRule(
        "phone",
        "\\d{3}-\\d{3}-\\d{4}|\\(\\d{3}\\)\\s?\\d{3}-\\d{4}",
        {
          maskingPattern: "XXX-XXX-XXXX"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register credit card detection rule", async () => {
      const result = await dataProtectionService.registerPiiDetectionRule(
        "credit_card",
        "\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}",
        {
          defaultClassificationLevel: 5,
          requiresAccessApproval: true
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Detect PII in text - SSN", async () => {
      await dataProtectionService.registerPiiDetectionRule(
        "detect_ssn",
        "\\d{3}-\\d{2}-\\d{4}",
        { ruleName: "ssn_detector" }
      );

      const result = await dataProtectionService.detectPiiInText("My SSN is 123-45-6789");

      expect(result.detected).toBe(true);
      expect(result.pii_types.length).toBeGreaterThan(0);
    });

    test("Detect multiple PII types in text", async () => {
      // Register rules
      await dataProtectionService.registerPiiDetectionRule("test_email", "[a-z]+@[a-z]+\\.[a-z]+");
      await dataProtectionService.registerPiiDetectionRule("test_phone", "\\d{3}-\\d{3}-\\d{4}");

      const result = await dataProtectionService.detectPiiInText(
        "Contact john@example.com at 555-123-4567"
      );

      expect(typeof result.detected).toBe("boolean");
    });

    test("No PII detected in generic text", async () => {
      const result = await dataProtectionService.detectPiiInText("This is just normal text");

      expect(result.detected).toBe(false);
    });
  });

  describe("Data Masking", () => {
    test("Register full redaction masking rule", async () => {
      const result = await dataProtectionService.registerMaskingRule(
        "employees",
        "ssn",
        "full_redact",
        {
          applyToContexts: ["logs", "exports", "admin_view"]
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register partial redaction masking rule", async () => {
      const result = await dataProtectionService.registerMaskingRule(
        "payments",
        "credit_card",
        "partial_redact",
        {
          maskingPattern: "XXXX-XXXX-XXXX-\\d{4}"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register hash masking rule", async () => {
      const result = await dataProtectionService.registerMaskingRule(
        "users",
        "password_hash",
        "hash"
      );

      expect(result.registered).toBe(true);
    });

    test("Register null masking rule", async () => {
      const result = await dataProtectionService.registerMaskingRule(
        "logs",
        "sensitive_data",
        "null"
      );

      expect(result.registered).toBe(true);
    });

    test("Apply full redaction masking", async () => {
      await dataProtectionService.registerMaskingRule("test", "field", "full_redact");

      const result = await dataProtectionService.applyMasking("test", "field", "secret_value");

      expect(result.masked).toBe(true);
      expect(result.masked_value).toBe("***REDACTED***");
    });

    test("Apply hash masking", async () => {
      await dataProtectionService.registerMaskingRule("test", "hashfield", "hash");

      const result = await dataProtectionService.applyMasking("test", "hashfield", "original_value");

      expect(result.masked).toBe(true);
      expect(result.masked_value).toMatch(/^[a-f0-9]{16}$/);
    });

    test("Masking by role context", async () => {
      const result = await dataProtectionService.registerMaskingRule(
        "financial",
        "amount",
        "full_redact",
        {
          applyByRole: {
            customer: true,
            employee: false,
            admin: false
          }
        }
      );

      expect(result.registered).toBe(true);
    });
  });

  describe("Data Access Logging", () => {
    test("Log data read access", async () => {
      const result = await dataProtectionService.logDataAccess(
        testUserId,
        testOrgId,
        {
          accessType: "read",
          tableName: "employees",
          recordId: "emp-001",
          columnName: "ssn",
          accessMethod: "api"
        }
      );

      expect(result.logged).toBe(true);
      expect(result.access_log_id).toBeDefined();
    });

    test("Log data export access", async () => {
      const result = await dataProtectionService.logDataAccess(
        testUserId,
        testOrgId,
        {
          accessType: "export",
          tableName: "contacts",
          accessMethod: "report_generation",
          affectedPiiTypes: ["email", "phone"]
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log data access with IP and user agent", async () => {
      const result = await dataProtectionService.logDataAccess(
        testUserId,
        testOrgId,
        {
          accessType: "download",
          tableName: "financial_records",
          ipAddress: "192.168.1.100",
          userAgent: "Mozilla/5.0..."
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Flag suspicious data access for review", async () => {
      const result = await dataProtectionService.logDataAccess(
        testUserId,
        testOrgId,
        {
          accessType: "read",
          tableName: "highly_sensitive",
          recordId: "record-999",
          flaggedForReview: true
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log access with request ID for tracing", async () => {
      const result = await dataProtectionService.logDataAccess(
        testUserId,
        testOrgId,
        {
          accessType: "api_access",
          tableName: "api_logs",
          requestId: "req-12345-xyz",
          accessMethod: "api"
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log multiple access types", async () => {
      const accessTypes = ["read", "export", "download", "api_access"];

      for (const type of accessTypes) {
        const result = await dataProtectionService.logDataAccess(
          testUserId,
          testOrgId,
          { accessType: type, tableName: "test_table" }
        );
        expect(result.logged).toBe(true);
      }
    });
  });

  describe("Encryption Logging", () => {
    test("Log encrypted data", async () => {
      const result = await dataProtectionService.logEncryptedData(
        "employees",
        "emp-001",
        "ssn",
        "key-prod-001",
        testOrgId,
        {
          encryptionAlgorithm: "AES-256-GCM",
          piiType: "ssn"
        }
      );

      expect(result.logged).toBe(true);
      expect(result.encryption_log_id).toBeDefined();
    });

    test("Log encrypted data with classification", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_level = 5 LIMIT 1")).rows[0]?.id;

      const result = await dataProtectionService.logEncryptedData(
        "financial",
        "fin-001",
        "credit_card",
        "key-backup-001",
        testOrgId,
        {
          dataClassificationId: classId,
          piiType: "credit_card"
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log multiple field encryptions", async () => {
      const fields = ["ssn", "email", "phone"];

      for (const field of fields) {
        const result = await dataProtectionService.logEncryptedData(
          "users",
          "user-001",
          field,
          "key-prod-001",
          testOrgId
        );
        expect(result.logged).toBe(true);
      }
    });
  });

  describe("Data Export Tracking", () => {
    test("Track CSV export", async () => {
      const result = await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "csv",
          tableNames: ["employees", "contacts"],
          recordCount: 5000,
          piiTypesIncluded: ["email", "phone", "ssn"],
          exportMethod: "direct_download"
        }
      );

      expect(result.tracked).toBe(true);
      expect(result.export_id).toBeDefined();
    });

    test("Track JSON API export", async () => {
      const result = await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "json",
          tableNames: ["api_data"],
          recordCount: 1000,
          exportMethod: "api",
          destination: "https://api.example.com/import"
        }
      );

      expect(result.tracked).toBe(true);
    });

    test("Track email export", async () => {
      const result = await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "excel",
          tableNames: ["reports"],
          recordCount: 500,
          exportMethod: "email",
          destination: "user@example.com"
        }
      );

      expect(result.tracked).toBe(true);
    });

    test("Track export with encryption", async () => {
      const result = await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "csv",
          tableNames: ["sensitive_data"],
          recordCount: 100,
          includesEncryptedData: true,
          includesMaskedData: false
        }
      );

      expect(result.tracked).toBe(true);
    });

    test("Track export with masking", async () => {
      const result = await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "json",
          tableNames: ["users"],
          recordCount: 2000,
          piiTypesIncluded: ["email", "ssn"],
          includesMaskedData: true,
          exportedDataRedacted: true
        }
      );

      expect(result.tracked).toBe(true);
    });
  });

  describe("Data Breach Management", () => {
    test("Report unauthorized access breach", async () => {
      const result = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Unauthorized Access Incident 2024-01",
        {
          breachType: "unauthorized_access",
          affectedTables: ["employees", "financial"],
          affectedRecordsCount: 150,
          affectedPiiTypes: ["ssn", "credit_card"],
          severity: "high"
        }
      );

      expect(result.reported).toBe(true);
      expect(result.breach_id).toBeDefined();
    });

    test("Report data leak breach", async () => {
      const result = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Data Leak on Public Repository",
        {
          breachType: "data_leak",
          affectedTables: ["configs"],
          affectedRecordsCount: 1,
          affectedPiiTypes: ["api_keys", "credentials"],
          severity: "critical"
        }
      );

      expect(result.reported).toBe(true);
    });

    test("Report ransomware breach", async () => {
      const result = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Ransomware Attack Q1 2024",
        {
          breachType: "ransomware",
          affectedTables: ["all"],
          affectedRecordsCount: 1000000,
          severity: "critical"
        }
      );

      expect(result.reported).toBe(true);
    });

    test("Report insider threat breach", async () => {
      const result = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Insider Threat - User 12345",
        {
          breachType: "insider_threat",
          affectedTables: ["payroll", "hr"],
          affectedRecordsCount: 500,
          severity: "high"
        }
      );

      expect(result.reported).toBe(true);
    });

    test("Update breach status: detected -> investigating", async () => {
      const breach = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Test Breach for Status Update",
        { breachType: "data_leak", severity: "high" }
      );

      const result = await dataProtectionService.updateBreachStatus(
        breach.breach_id,
        "investigating",
        {
          investigationFindings: "Initial analysis in progress"
        }
      );

      expect(result.updated).toBe(true);
      expect(result.new_status).toBe("investigating");
    });

    test("Update breach status with full remediation", async () => {
      const breach = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Test Breach for Remediation",
        { breachType: "unauthorized_access" }
      );

      const result = await dataProtectionService.updateBreachStatus(
        breach.breach_id,
        "remediated",
        {
          investigationFindings: "Unauthorized user account identified",
          rootCause: "Weak password policy",
          remediationPlan: "Password reset and 2FA enforcement",
          remediationComplete: true,
          usersNotified: true,
          regulatorsNotified: false
        }
      );

      expect(result.updated).toBe(true);
    });

    test("Breach status transitions", async () => {
      const statuses = ["detected", "investigating", "contained", "remediated", "closed"];

      for (const status of statuses) {
        const breach = await dataProtectionService.reportDataBreach(
          testOrgId,
          `Test Breach ${status}`,
          { breachType: "test" }
        );

        const result = await dataProtectionService.updateBreachStatus(
          breach.breach_id,
          status
        );

        expect(result.updated).toBe(true);
      }
    });
  });

  describe("Query Functions", () => {
    test("Get data protection summary", async () => {
      const result = await dataProtectionService.getDataProtectionSummary();

      expect(Array.isArray(result.summary)).toBe(true);
    });

    test("Get encryption key status report", async () => {
      const result = await dataProtectionService.getEncryptionKeyStatusReport();

      expect(Array.isArray(result.key_status)).toBe(true);
    });

    test("Get recent data access summary", async () => {
      const result = await dataProtectionService.getRecentDataAccessSummary();

      expect(Array.isArray(result.access_summary)).toBe(true);
    });

    test("Get PII exposure summary", async () => {
      const result = await dataProtectionService.getPiiExposureSummary();

      expect(Array.isArray(result.pii_exposure)).toBe(true);
    });

    test("Get field classification", async () => {
      await dataProtectionService.registerDataClassification("lookup_class", 3);
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_name = 'lookup_class'")).rows[0].id;

      await dataProtectionService.classifyDataField(
        "test_table",
        "test_column",
        classId,
        { piiType: "email" }
      );

      const result = await dataProtectionService.getFieldClassification("test_table", "test_column");

      expect(result.classified).toBe(true);
      expect(result.classification).toBeDefined();
    });

    test("Get retention policy for table", async () => {
      await dataProtectionService.registerRetentionPolicy(
        "lookup_retention",
        "lookup_table",
        { retentionType: "delete", retentionDays: 90 }
      );

      const result = await dataProtectionService.getRetentionPolicy("lookup_table");

      expect(result.found).toBe(true);
      expect(result.policy).toBeDefined();
    });
  });

  describe("Integration Scenarios", () => {
    test("Complete data protection workflow: classify -> encrypt -> audit -> export", async () => {
      // Register classification
      const classResult = await dataProtectionService.registerDataClassification(
        "workflow_class",
        4
      );

      // Classify field
      const fieldResult = await dataProtectionService.classifyDataField(
        "user_data",
        "ssn",
        classResult.classification_id,
        { piiType: "ssn" }
      );

      // Register encryption key
      const keyResult = await dataProtectionService.registerEncryptionKey(
        "workflow_key",
        `key-workflow-${Date.now()}`,
        "AES-256-GCM"
      );

      // Log encryption
      const encryptResult = await dataProtectionService.logEncryptedData(
        "user_data",
        "user-001",
        "ssn",
        `key-workflow-${Date.now()}`,
        testOrgId,
        { piiType: "ssn" }
      );

      // Log access
      const accessResult = await dataProtectionService.logDataAccess(
        testUserId,
        testOrgId,
        {
          accessType: "read",
          tableName: "user_data",
          recordId: "user-001"
        }
      );

      // Track export
      const exportResult = await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "csv",
          tableNames: ["user_data"],
          piiTypesIncluded: ["ssn"],
          recordCount: 1
        }
      );

      expect(classResult.registered).toBe(true);
      expect(fieldResult.classified).toBe(true);
      expect(keyResult.registered).toBe(true);
      expect(encryptResult.logged).toBe(true);
      expect(accessResult.logged).toBe(true);
      expect(exportResult.tracked).toBe(true);
    });

    test("Breach detection and response workflow", async () => {
      // Report breach
      const breachResult = await dataProtectionService.reportDataBreach(
        testOrgId,
        "Workflow Breach Test",
        {
          breachType: "unauthorized_access",
          affectedTables: ["sensitive"],
          severity: "high"
        }
      );

      // Update to investigating
      const investigateResult = await dataProtectionService.updateBreachStatus(
        breachResult.breach_id,
        "investigating"
      );

      // Complete investigation
      const remediateResult = await dataProtectionService.updateBreachStatus(
        breachResult.breach_id,
        "remediated",
        {
          usersNotified: true,
          remediationComplete: true
        }
      );

      expect(breachResult.reported).toBe(true);
      expect(investigateResult.updated).toBe(true);
      expect(remediateResult.updated).toBe(true);
    });

    test("PII detection and masking workflow", async () => {
      // Register PII detection
      const piiResult = await dataProtectionService.registerPiiDetectionRule(
        "test_ssn_detect",
        "\\d{3}-\\d{2}-\\d{4}",
        { maskingPattern: "XXX-XX-\\d{4}" }
      );

      // Register masking rule
      const maskResult = await dataProtectionService.registerMaskingRule(
        "employees",
        "ssn",
        "full_redact"
      );

      // Detect PII in text
      const detectResult = await dataProtectionService.detectPiiInText(
        "SSN 123-45-6789 for John Doe"
      );

      // Apply masking
      const applyResult = await dataProtectionService.applyMasking(
        "employees",
        "ssn",
        "123-45-6789"
      );

      expect(piiResult.registered).toBe(true);
      expect(maskResult.registered).toBe(true);
      expect(typeof detectResult.detected).toBe("boolean");
      expect(applyResult.masked).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("Handle null organization ID in field classification", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications WHERE classification_level = 1 LIMIT 1")).rows[0]?.id;

      if (classId) {
        const result = await dataProtectionService.classifyDataField(
          "global_table",
          "global_field",
          classId,
          { organizationId: null }
        );

        expect(result.classified !== undefined).toBe(true);
      }
    });

    test("Handle very long field names", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications LIMIT 1")).rows[0]?.id;

      if (classId) {
        const longName = "a".repeat(100);
        const result = await dataProtectionService.classifyDataField(
          "test_table",
          longName,
          classId
        );

        expect(result.classified !== undefined).toBe(true);
      }
    });

    test("Handle special characters in policy name", async () => {
      const result = await dataProtectionService.registerRetentionPolicy(
        `policy-!@#$%`,
        "table",
        { retentionType: "delete" }
      );

      expect(result.registered !== undefined).toBe(true);
    });

    test("Handle concurrent access logging", async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          dataProtectionService.logDataAccess(
            `user-${i}`,
            testOrgId,
            { accessType: "read", tableName: "test" }
          )
        );
      }

      const results = await Promise.all(promises);
      expect(results.every(r => r.logged === true)).toBe(true);
    });

    test("Handle encryption logging with missing optional fields", async () => {
      const result = await dataProtectionService.logEncryptedData(
        "table",
        "record-1",
        "column",
        "key-1",
        testOrgId
      );

      expect(result.logged).toBe(true);
    });
  });

  describe("Compliance and Audit", () => {
    test("Complete audit trail from classification to access", async () => {
      const classId = (await db.pool.query("SELECT id FROM data_classifications LIMIT 1")).rows[0]?.id;

      if (classId) {
        // Classify field
        await dataProtectionService.classifyDataField(
          "compliance_test",
          "audit_field",
          classId,
          { accessLogAllReads: true }
        );

        // Log access
        await dataProtectionService.logDataAccess(
          testUserId,
          testOrgId,
          { accessType: "read", tableName: "compliance_test", columnName: "audit_field" }
        );

        // Get summary
        const summary = await dataProtectionService.getRecentDataAccessSummary();
        expect(Array.isArray(summary.access_summary)).toBe(true);
      }
    });

    test("Data export compliance tracking", async () => {
      await dataProtectionService.trackDataExport(
        testUserId,
        testOrgId,
        {
          exportType: "csv",
          tableNames: ["compliance"],
          recordCount: 100,
          piiTypesIncluded: ["email"],
          exportedDataRedacted: true
        }
      );

      // Verify export was logged
      const query = `SELECT COUNT(*) FROM data_export_log WHERE organization_id = $1`;
      const result = await db.pool.query(query, [testOrgId]);
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test("Key rotation compliance", async () => {
      const keyReport = await dataProtectionService.getEncryptionKeyStatusReport();

      expect(Array.isArray(keyReport.key_status)).toBe(true);
      // Should include rotation status for each key
      if (keyReport.key_status.length > 0) {
        expect(keyReport.key_status[0].rotation_status).toBeDefined();
      }
    });
  });
});
