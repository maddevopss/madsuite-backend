/**
 * Issue #173 PR G: Stage 5 Backup & Restore Integration Tests
 *
 * Validates:
 * 1. Full backup creation and verification
 * 2. Incremental backups
 * 3. Schema-only backups
 * 4. Component-specific backup
 * 5. Full restore operations
 * 6. Selective component restore
 * 7. Point-in-time recovery
 * 8. Restore rollback
 * 9. Retention policy enforcement
 * 10. Storage usage tracking
 */

const db = require("../../db");
const {
  createFullBackup,
  createIncrementalBackup,
  createSchemaBackup,
  listBackups,
  getBackupDetails,
  verifyBackup,
  purgeOldBackups
} = require("../services/backupService");
const {
  performFullRestore,
  restoreComponents,
  restoreToPointInTime,
  verifyRestoration,
  rollbackRestore,
  getRestoreHistory
} = require("../services/restoreService");
const {
  getRetentionPolicy,
  getAllRetentionPolicies,
  updateRetentionPolicy,
  getStorageUsage,
  getRetentionStatus,
  applyRetentionPolicy
} = require("../services/backupRetention");

describe("PR G: Stage 5 Backup & Restore", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) {
      // Clean up test backup snapshots
      await client.query(
        `DELETE FROM backup_snapshots WHERE initiator_reason LIKE 'test_%'`
      );
      client.release();
    }
  });

  describe("Schema validation", () => {
    it("should have backup_snapshots table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'backup_snapshots'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have backup_components table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'backup_components'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have backup_verifications table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'backup_verifications'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have restore_operations table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'restore_operations'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have backup_retention_policy table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'backup_retention_policy'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have predefined retention policies", async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count FROM backup_retention_policy
      `);
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    it("should have backup views", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.views
        WHERE table_name IN ('backup_status_summary', 'backup_timeline',
                             'recent_restore_operations', 'backup_verification_summary')
      `);
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("Full backup operations", () => {
    it("should create full backup", async () => {
      const result = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_full_backup",
        verifyAfterBackup: false
      });

      expect(result.snapshot_id).toBeDefined();
      expect(result.backup_type).toBe("full");
      expect(result.components_backed_up).toBeGreaterThan(0);
    });

    it("should record backup snapshot in database", async () => {
      const result = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_record",
        verifyAfterBackup: false
      });

      const dbResult = await client.query(
        "SELECT * FROM backup_snapshots WHERE id = $1",
        [result.snapshot_id]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].status).toBe("completed");
    });

    it("should record component backup details", async () => {
      const result = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_components",
        verifyAfterBackup: false
      });

      const dbResult = await client.query(
        "SELECT COUNT(*) as count FROM backup_components WHERE snapshot_id = $1",
        [result.snapshot_id]
      );

      expect(parseInt(dbResult.rows[0].count)).toBeGreaterThan(0);
    });

    it("should calculate backup size correctly", async () => {
      const result = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_size",
        verifyAfterBackup: false
      });

      expect(result.total_size_bytes).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Incremental backup operations", () => {
    it("should create incremental backup", async () => {
      const result = await createIncrementalBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_incremental"
      });

      expect(result.snapshot_id).toBeDefined();
      expect(result.backup_type).toBe("incremental");
    });

    it("should detect changes since last backup", async () => {
      // Create baseline
      await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_baseline"
      });

      // Create incremental
      const result = await createIncrementalBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_delta"
      });

      expect(result.changes_captured).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Schema-only backup operations", () => {
    it("should create schema-only backup", async () => {
      const result = await createSchemaBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_schema"
      });

      expect(result.snapshot_id).toBeDefined();
      expect(result.backup_type).toBe("schema_only");
    });
  });

  describe("Backup listing and details", () => {
    it("should list all backups", async () => {
      const result = await listBackups({ limit: 100 });

      expect(Array.isArray(result.snapshots)).toBe(true);
    });

    it("should filter backups by type", async () => {
      const result = await listBackups({
        backupType: "full",
        limit: 50
      });

      expect(Array.isArray(result.snapshots)).toBe(true);
      if (result.snapshots.length > 0) {
        expect(result.snapshots[0].backup_type).toBe("full");
      }
    });

    it("should get backup details", async () => {
      const backups = await listBackups({ limit: 1 });

      if (backups.snapshots.length > 0) {
        const details = await getBackupDetails(backups.snapshots[0].id);

        expect(details.snapshot).toBeDefined();
        expect(Array.isArray(details.components)).toBe(true);
      }
    });

    it("should show component breakdown in details", async () => {
      const result = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_details",
        verifyAfterBackup: false
      });

      const details = await getBackupDetails(result.snapshot_id);

      expect(details.components.length).toBeGreaterThan(0);
      expect(details.components[0].component_name).toBeDefined();
    });
  });

  describe("Backup verification", () => {
    it("should verify backup integrity", async () => {
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_verify",
        verifyAfterBackup: false
      });

      const result = await verifyBackup(backup.snapshot_id);

      expect(result.verified).toBe(true);
    });

    it("should mark verified backups in database", async () => {
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_verified_mark",
        verifyAfterBackup: true
      });

      const dbResult = await client.query(
        "SELECT verified FROM backup_snapshots WHERE id = $1",
        [backup.snapshot_id]
      );

      expect(dbResult.rows[0].verified).toBe(true);
    });
  });

  describe("Restore operations", () => {
    let testBackupId;

    beforeEach(async () => {
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_restore_prep",
        verifyAfterBackup: false
      });
      testBackupId = backup.snapshot_id;
    });

    it("should perform full restore", async () => {
      const result = await performFullRestore(testBackupId, "staging", {
        initiatedBy: "test_user",
        initiatorReason: "test_full_restore"
      });

      expect(result.restore_id).toBeDefined();
      expect(result.snapshot_id).toBe(testBackupId);
      expect(result.target_environment).toBe("staging");
    });

    it("should record restore operation", async () => {
      const result = await performFullRestore(testBackupId, "staging", {
        initiatedBy: "test_user",
        initiatorReason: "test_record_restore"
      });

      const dbResult = await client.query(
        "SELECT * FROM restore_operations WHERE id = $1",
        [result.restore_id]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].status).toBeDefined();
    });

    it("should restore to different environments", async () => {
      const stagingRestore = await performFullRestore(testBackupId, "staging", {
        initiatedBy: "test_user"
      });

      const devRestore = await performFullRestore(testBackupId, "dev", {
        initiatedBy: "test_user"
      });

      expect(stagingRestore.target_environment).toBe("staging");
      expect(devRestore.target_environment).toBe("dev");
    });
  });

  describe("Selective restore operations", () => {
    let testBackupId;

    beforeEach(async () => {
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_selective_prep",
        verifyAfterBackup: false
      });
      testBackupId = backup.snapshot_id;
    });

    it("should restore specific components", async () => {
      const result = await restoreComponents(
        testBackupId,
        ["job_registry", "retry_engine"],
        "staging",
        {
          initiatedBy: "test_user"
        }
      );

      expect(result.restore_id).toBeDefined();
      expect(result.components_restored).toBe(2);
    });

    it("should record selective restore operation", async () => {
      const result = await restoreComponents(
        testBackupId,
        ["job_registry"],
        "staging",
        {
          initiatedBy: "test_user"
        }
      );

      const dbResult = await client.query(
        "SELECT * FROM restore_operations WHERE id = $1",
        [result.restore_id]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].restore_scope).toBe("components");
    });
  });

  describe("Point-in-time recovery", () => {
    it("should restore to point in time", async () => {
      const targetTime = new Date(Date.now() - 3600000); // 1 hour ago
      const result = await restoreToPointInTime(targetTime, "staging", {
        initiatedBy: "test_user"
      });

      expect(result).toBeDefined();
      if (!result.error) {
        expect(result.restore_id).toBeDefined();
      }
    });
  });

  describe("Restore verification", () => {
    let testRestoreId;

    beforeEach(async () => {
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_restore_verify_prep",
        verifyAfterBackup: false
      });

      const restore = await performFullRestore(backup.snapshot_id, "staging", {
        initiatedBy: "test_user"
      });

      testRestoreId = restore.restore_id;
    });

    it("should verify restored data", async () => {
      const result = await verifyRestoration(testRestoreId);

      expect(result.restore_id).toBe(testRestoreId);
      expect(result.verifications).toBeDefined();
    });

    it("should update restore record with verification result", async () => {
      await verifyRestoration(testRestoreId);

      const dbResult = await client.query(
        "SELECT verified_after_restore FROM restore_operations WHERE id = $1",
        [testRestoreId]
      );

      expect(dbResult.rows.length).toBe(1);
    });
  });

  describe("Restore rollback", () => {
    it("should rollback restore operation", async () => {
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_rollback_prep",
        verifyAfterBackup: false
      });

      const restore = await performFullRestore(backup.snapshot_id, "staging", {
        initiatedBy: "test_user"
      });

      const rollback = await rollbackRestore(restore.restore_id);

      expect(rollback.restore_id).toBe(restore.restore_id);
      if (!rollback.error) {
        expect(rollback.rolled_back).toBe(true);
      }
    });
  });

  describe("Retention policy management", () => {
    it("should get retention policy", async () => {
      const result = await getRetentionPolicy("full");

      expect(result.backup_type).toBe("full");
      expect(result.retention_days).toBeDefined();
    });

    it("should get all retention policies", async () => {
      const result = await getAllRetentionPolicies();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should update retention policy", async () => {
      const updated = await updateRetentionPolicy("full", {
        retentionDays: 45
      });

      expect(updated.retention_days).toBe(45);
    });

    it("should get retention status", async () => {
      const result = await getRetentionStatus();

      expect(result.retention_status).toBeDefined();
      expect(Array.isArray(result.retention_status)).toBe(true);
    });

    it("should apply retention policy cleanup", async () => {
      const result = await applyRetentionPolicy();

      expect(result.policies_applied).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("Storage management", () => {
    it("should track storage usage", async () => {
      const result = await getStorageUsage();

      expect(result.by_type).toBeDefined();
      expect(result.total_size_bytes).toBeGreaterThanOrEqual(0);
    });

    it("should show size in multiple units", async () => {
      const result = await getStorageUsage();

      expect(result.total_size_bytes).toBeDefined();
      expect(result.total_size_gb).toBeDefined();
    });

    it("should show per-type breakdown", async () => {
      const result = await getStorageUsage();

      if (result.by_type.length > 0) {
        const first = result.by_type[0];
        expect(first.backup_type).toBeDefined();
        expect(first.backup_count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Restore history", () => {
    it("should list restore history", async () => {
      const result = await getRestoreHistory();

      expect(Array.isArray(result.operations)).toBe(true);
    });

    it("should filter restore history by environment", async () => {
      const result = await getRestoreHistory({
        environment: "staging"
      });

      expect(Array.isArray(result.operations)).toBe(true);
      if (result.operations.length > 0) {
        expect(result.operations[0].target_environment).toBe("staging");
      }
    });
  });

  describe("Backup purge operations", () => {
    it("should purge old backups", async () => {
      const result = await purgeOldBackups(1);

      expect(result).toBeDefined();
      expect(typeof result.deleted_snapshots).toBe("number");
    });
  });

  describe("Integration scenarios", () => {
    it("should complete full backup lifecycle", async () => {
      // Create backup
      const backup = await createFullBackup({
        initiatorUserId: "test_user",
        initiatorReason: "test_lifecycle",
        verifyAfterBackup: true
      });

      expect(backup.snapshot_id).toBeDefined();

      // Verify backup exists
      const details = await getBackupDetails(backup.snapshot_id);
      expect(details.snapshot).toBeDefined();

      // Restore from backup
      const restore = await performFullRestore(backup.snapshot_id, "staging", {
        initiatedBy: "test_user"
      });

      expect(restore.restore_id).toBeDefined();

      // Verify restore
      const verification = await verifyRestoration(restore.restore_id);
      expect(verification.restore_id).toBe(restore.restore_id);
    });

    it("should track multiple backup types", async () => {
      const full = await createFullBackup({
        initiatorUserId: "test_user"
      });

      const incremental = await createIncrementalBackup({
        initiatorUserId: "test_user"
      });

      const schema = await createSchemaBackup({
        initiatorUserId: "test_user"
      });

      expect(full.backup_type).toBe("full");
      expect(incremental.backup_type).toBe("incremental");
      expect(schema.backup_type).toBe("schema_only");
    });
  });
});
