/**
 * Issue #173 PR C: Retry Engine & Quarantine Integration Tests
 *
 * Validates:
 * 1. Schema tables (retry_attempts, quarantine_queue, recovery_operations, retry_policies)
 * 2. Backoff calculation strategies (exponential, linear, fixed)
 * 3. Retry attempt recording with status/error tracking
 * 4. Error classification (transient vs permanent)
 * 5. Retry vs quarantine decision logic
 * 6. Quarantine management and recovery
 * 7. Retry policy management
 * 8. Statistics and cleanup
 */

const db = require("../../db");
const {
  calculateBackoffDelay,
  recordRetryAttempt,
  classifyError,
  handleRetryOrQuarantine,
  quarantineWork,
  getQuarantineItem,
  getQuarantineQueue,
  initiateRecovery,
  markRecoverySucceeded,
  markRecoveryFailed,
  getRetryPolicy,
  getAllRetryPolicies,
  getRetryStats,
  getQuarantineStats,
  cleanupRetryAttempts
} = require("../services/retryEngine");

describe("PR C: Retry Engine & Quarantine", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) {
      // Clean up test data
      await client.query(`DELETE FROM recovery_operations WHERE quarantine_id IN
        (SELECT id FROM quarantine_queue WHERE work_type LIKE 'test_%')`);
      await client.query(`DELETE FROM quarantine_queue WHERE work_type LIKE 'test_%'`);
      await client.query(`DELETE FROM retry_attempts WHERE work_type LIKE 'test_%'`);
      client.release();
    }
  });

  describe("Schema validation", () => {
    it("should have retry_attempts table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'retry_attempts'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have quarantine_queue table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'quarantine_queue'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have recovery_operations table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'recovery_operations'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have retry_policies table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'retry_policies'
      `);
      expect(result.rows.length).toBe(1);
    });
  });

  describe("Backoff delay calculation", () => {
    it("should calculate exponential backoff", () => {
      const delay1 = calculateBackoffDelay("exponential", 60, 1.5, 1);
      expect(delay1).toBe(60);

      const delay2 = calculateBackoffDelay("exponential", 60, 1.5, 2);
      expect(delay2).toBe(90);

      const delay3 = calculateBackoffDelay("exponential", 60, 1.5, 3);
      expect(delay3).toBe(135);
    });

    it("should cap exponential backoff at 10x multiplier", () => {
      const delay = calculateBackoffDelay("exponential", 60, 1.5, 20);
      expect(delay).toBe(60 * Math.pow(1.5, 10));
    });

    it("should calculate linear backoff", () => {
      const delay1 = calculateBackoffDelay("linear", 60, 1.0, 1);
      expect(delay1).toBe(60);

      const delay2 = calculateBackoffDelay("linear", 60, 1.0, 2);
      expect(delay2).toBe(120);

      const delay3 = calculateBackoffDelay("linear", 60, 1.0, 3);
      expect(delay3).toBe(180);
    });

    it("should calculate fixed backoff", () => {
      const delay1 = calculateBackoffDelay("fixed", 60, 2.0, 1);
      expect(delay1).toBe(60);

      const delay2 = calculateBackoffDelay("fixed", 60, 2.0, 5);
      expect(delay2).toBe(60);
    });

    it("should default to initial backoff for unknown strategy", () => {
      const delay = calculateBackoffDelay("unknown", 60, 1.5, 2);
      expect(delay).toBe(60);
    });
  });

  describe("Error classification", () => {
    it("should classify network errors as transient", () => {
      const result = classifyError(
        new Error("ECONNREFUSED"),
        "500",
        null
      );
      expect(result.classification).toBe("transient");
      expect(result.errorClassification).toBe("network");
    });

    it("should classify timeout errors as transient", () => {
      const result = classifyError(
        new Error("Request timeout"),
        "408",
        null
      );
      expect(result.classification).toBe("transient");
      expect(result.errorClassification).toBe("network");
    });

    it("should classify rate limit errors", () => {
      const result = classifyError(
        new Error("Too many requests"),
        "429",
        null
      );
      expect(result.classification).toBe("transient");
      expect(result.errorClassification).toBe("rate_limit");
    });

    it("should classify validation errors as permanent", () => {
      const result = classifyError(
        new Error("Validation failed"),
        "422",
        null
      );
      expect(result.classification).toBe("permanent");
      expect(result.errorClassification).toBe("validation");
    });

    it("should classify 401/403 as permanent", () => {
      const result401 = classifyError(new Error("Unauthorized"), "401", null);
      expect(result401.classification).toBe("permanent");

      const result403 = classifyError(new Error("Forbidden"), "403", null);
      expect(result403.classification).toBe("permanent");
    });

    it("should respect permanent error codes in policy", () => {
      const policy = {
        permanent_error_codes: ["custom_error_100"]
      };
      const result = classifyError(
        new Error("Custom error"),
        "custom_error_100",
        policy
      );
      expect(result.classification).toBe("permanent");
      expect(result.errorClassification).toBe("validation");
    });

    it("should classify unknown errors as transient", () => {
      const result = classifyError(
        new Error("Unknown error"),
        "999",
        null
      );
      expect(result.classification).toBe("transient");
      expect(result.errorClassification).toBe("unknown");
    });
  });

  describe("Retry attempt recording", () => {
    it("should record retry attempt with pending status", async () => {
      const result = await recordRetryAttempt("test_work_type", "work_123", {
        attemptNumber: 1,
        status: "pending",
        errorCode: "TIMEOUT",
        errorMessage: "Request timed out",
        backoffStrategy: "exponential",
        backoffMultiplier: 1.5
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.backoff_seconds).toBeGreaterThanOrEqual(0);
    });

    it("should calculate backoff seconds for attempt 2+", async () => {
      const result = await recordRetryAttempt("test_work_type", "work_124", {
        attemptNumber: 2,
        status: "pending",
        backoffStrategy: "exponential",
        backoffMultiplier: 1.5
      });

      expect(result.backoff_seconds).toBeGreaterThan(0);
    });

    it("should record attempt with metadata", async () => {
      const metadata = { userId: "user_123", endpoint: "/api/v1/data" };
      const result = await recordRetryAttempt("test_work_type", "work_125", {
        attemptNumber: 1,
        status: "failed_transient",
        metadata
      });

      const attempt = await client.query(
        `SELECT metadata FROM retry_attempts WHERE id = $1`,
        [result.id]
      );

      expect(attempt.rows[0].metadata).toEqual(metadata);
    });

    it("should track multiple attempts for same work", async () => {
      const workId = "work_126";

      await recordRetryAttempt("test_work_type", workId, {
        attemptNumber: 1,
        status: "failed_transient"
      });

      await recordRetryAttempt("test_work_type", workId, {
        attemptNumber: 2,
        status: "failed_transient"
      });

      const attempts = await client.query(
        `SELECT * FROM retry_attempts WHERE work_type = $1 AND work_id = $2 ORDER BY attempt_number`,
        ["test_work_type", workId]
      );

      expect(attempts.rows.length).toBe(2);
      expect(attempts.rows[0].attempt_number).toBe(1);
      expect(attempts.rows[1].attempt_number).toBe(2);
    });
  });

  describe("Retry vs quarantine decision", () => {
    it("should quarantine on permanent error immediately", async () => {
      const result = await handleRetryOrQuarantine("test_work_type", "work_perm_1", {
        attemptNumber: 1,
        maxAttempts: 3,
        error: new Error("Invalid request"),
        errorCode: "422",
        errorMessage: "Validation failed",
        payload: { data: "test" }
      });

      expect(result.action).toBe("quarantine");
      expect(result.reason).toBe("permanent_error");
    });

    it("should retry on transient error before max attempts", async () => {
      const result = await handleRetryOrQuarantine("test_work_type", "work_trans_1", {
        attemptNumber: 1,
        maxAttempts: 3,
        error: new Error("ECONNREFUSED"),
        errorCode: "500",
        errorMessage: "Service unavailable",
        payload: { data: "test" }
      });

      expect(result.action).toBe("retry");
      expect(result.nextAttempt).toBe(2);
    });

    it("should quarantine when max attempts exceeded", async () => {
      const result = await handleRetryOrQuarantine("test_work_type", "work_maxattempt_1", {
        attemptNumber: 3,
        maxAttempts: 3,
        error: new Error("Timeout"),
        errorCode: "408",
        errorMessage: "Request timeout",
        payload: { data: "test" }
      });

      expect(result.action).toBe("quarantine");
      expect(result.reason).toBe("max_retries_exceeded");
    });

    it("should include custom retry policy in decision", async () => {
      const policy = {
        permanent_error_codes: ["custom_permanent"]
      };

      const result = await handleRetryOrQuarantine("test_work_type", "work_policy_1", {
        attemptNumber: 1,
        maxAttempts: 3,
        error: new Error("Custom error"),
        errorCode: "custom_permanent",
        errorMessage: "Permanent custom error",
        payload: { data: "test" },
        retryPolicy: policy
      });

      expect(result.action).toBe("quarantine");
      expect(result.reason).toBe("permanent_error");
    });
  });

  describe("Quarantine management", () => {
    it("should quarantine work item", async () => {
      const result = await quarantineWork("test_work_type", "work_q_1", {
        reason: "permanent_error",
        errorCode: "422",
        errorMessage: "Invalid data",
        payload: { id: "123", data: "test" },
        tags: ["email", "critical"]
      });

      expect(result.id).toBeDefined();
    });

    it("should get quarantine item", async () => {
      await quarantineWork("test_work_type", "work_q_2", {
        reason: "max_retries_exceeded",
        errorCode: "500",
        errorMessage: "Service error",
        payload: { id: "456" }
      });

      const item = await getQuarantineItem("test_work_type", "work_q_2");
      expect(item).toBeDefined();
      expect(item.work_type).toBe("test_work_type");
      expect(item.work_id).toBe("work_q_2");
      expect(item.reason).toBe("max_retries_exceeded");
    });

    it("should get quarantine queue by work type", async () => {
      await quarantineWork("test_work_type", "work_q_3", {
        reason: "permanent_error",
        payload: { test: true }
      });

      const items = await getQuarantineQueue("test_work_type");
      expect(items.length).toBeGreaterThan(0);
      expect(items.every(i => i.work_type === "test_work_type")).toBe(true);
    });

    it("should filter quarantine queue by reason", async () => {
      await quarantineWork("test_work_type", "work_q_4", {
        reason: "permanent_error",
        payload: { test: true }
      });

      await quarantineWork("test_work_type", "work_q_5", {
        reason: "max_retries_exceeded",
        payload: { test: true }
      });

      const items = await getQuarantineQueue("test_work_type", {
        reason: "permanent_error"
      });

      expect(items.some(i => i.work_id === "work_q_4")).toBe(true);
      expect(items.every(i => i.reason === "permanent_error")).toBe(true);
    });

    it("should filter quarantine queue by recovery status", async () => {
      await quarantineWork("test_work_type", "work_q_6", {
        reason: "permanent_error",
        payload: { test: true }
      });

      const items = await getQuarantineQueue("test_work_type", {
        recoveryStatus: "waiting"
      });

      expect(items.length).toBeGreaterThan(0);
    });

    it("should update quarantine on re-quarantine", async () => {
      const workId = "work_q_reupdate";

      await quarantineWork("test_work_type", workId, {
        reason: "permanent_error",
        errorMessage: "First error",
        payload: { attempt: 1 }
      });

      await quarantineWork("test_work_type", workId, {
        reason: "permanent_error",
        errorMessage: "Updated error",
        payload: { attempt: 2 }
      });

      const item = await getQuarantineItem("test_work_type", workId);
      expect(item.permanent_error_message).toBe("Updated error");
    });
  });

  describe("Recovery operations", () => {
    it("should initiate recovery for quarantined work", async () => {
      const qItem = await quarantineWork("test_work_type", "work_recovery_1", {
        reason: "permanent_error",
        errorMessage: "Initial error",
        payload: { id: "123" }
      });

      const recovery = await initiateRecovery(qItem.id, {
        operationType: "manual_retry",
        initiatedBy: "admin@example.com"
      });

      expect(recovery.id).toBeDefined();
      expect(recovery.initiated_at).toBeDefined();
    });

    it("should mark recovery as succeeded", async () => {
      const qItem = await quarantineWork("test_work_type", "work_recovery_2", {
        reason: "permanent_error",
        payload: { id: "456" }
      });

      const recovery = await initiateRecovery(qItem.id, {
        operationType: "fix_and_retry",
        initiatedBy: "admin@example.com"
      });

      await markRecoverySucceeded(recovery.id, "Successfully processed");

      const updated = await getQuarantineItem("test_work_type", "work_recovery_2");
      expect(updated.recovery_status).toBe("recovered");
    });

    it("should mark recovery as failed", async () => {
      const qItem = await quarantineWork("test_work_type", "work_recovery_3", {
        reason: "permanent_error",
        payload: { id: "789" }
      });

      const recovery = await initiateRecovery(qItem.id, {
        operationType: "manual_retry",
        initiatedBy: "admin@example.com"
      });

      await markRecoveryFailed(recovery.id, "Processing still failed");

      const updated = await client.query(
        `SELECT status FROM recovery_operations WHERE id = $1`,
        [recovery.id]
      );

      expect(updated.rows[0].status).toBe("failed");
    });

    it("should support payload override in recovery", async () => {
      const qItem = await quarantineWork("test_work_type", "work_recovery_4", {
        reason: "permanent_error",
        payload: { id: "999", badData: true }
      });

      const fixedPayload = { id: "999", badData: false };
      const recovery = await initiateRecovery(qItem.id, {
        operationType: "fix_and_retry",
        initiatedBy: "admin@example.com",
        payloadOverride: fixedPayload
      });

      expect(recovery.id).toBeDefined();
    });
  });

  describe("Retry policy management", () => {
    it("should get predefined retry policy", async () => {
      const policy = await getRetryPolicy("aggressive");
      expect(policy).toBeDefined();
      expect(policy.policy_name).toBe("aggressive");
      expect(policy.max_attempts).toBe(5);
    });

    it("should get all retry policies", async () => {
      const policies = await getAllRetryPolicies();
      expect(policies.length).toBeGreaterThanOrEqual(6);
      expect(policies.map(p => p.policy_name)).toContain("aggressive");
      expect(policies.map(p => p.policy_name)).toContain("moderate");
    });

    it("should validate policy configurations", async () => {
      const aggressive = await getRetryPolicy("aggressive");
      expect(aggressive.backoff_strategy).toBe("exponential");
      expect(aggressive.initial_backoff_seconds).toBe(10);
      expect(aggressive.max_attempts).toBe(5);

      const conservative = await getRetryPolicy("conservative");
      expect(conservative.backoff_strategy).toBe("linear");
      expect(conservative.max_attempts).toBe(3);
    });
  });

  describe("Statistics and reporting", () => {
    it("should get retry statistics for work type", async () => {
      // Record some attempts
      await recordRetryAttempt("test_stats_type", "work_1", {
        attemptNumber: 1,
        status: "failed_transient"
      });

      await recordRetryAttempt("test_stats_type", "work_2", {
        attemptNumber: 1,
        status: "success"
      });

      const stats = await getRetryStats("test_stats_type");
      expect(stats.length).toBeGreaterThan(0);
    });

    it("should get quarantine statistics", async () => {
      await quarantineWork("test_stats_type", "work_stats_1", {
        reason: "permanent_error",
        payload: { test: true }
      });

      const stats = await getQuarantineStats();
      expect(Array.isArray(stats)).toBe(true);
    });

    it("should include recovery attempts in statistics", async () => {
      const qItem = await quarantineWork("test_stats_type", "work_recovery_stat", {
        reason: "max_retries_exceeded",
        payload: { test: true }
      });

      await initiateRecovery(qItem.id, {
        operationType: "manual_retry",
        initiatedBy: "admin@example.com"
      });

      const stats = await getQuarantineStats();
      expect(stats.length).toBeGreaterThan(0);
    });
  });

  describe("Cleanup operations", () => {
    it("should clean up old retry attempts", async () => {
      // Record attempt with old timestamp
      await client.query(`
        INSERT INTO retry_attempts (
          work_type, work_id, attempt_number, attempt_at, status,
          backoff_strategy
        ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP - INTERVAL '60 days', $4, $5)
      `, ["cleanup_test", "work_old", 1, "success", "exponential"]);

      await cleanupRetryAttempts(30);

      const remaining = await client.query(
        `SELECT * FROM retry_attempts WHERE work_type = $1`,
        ["cleanup_test"]
      );

      expect(remaining.rows.length).toBe(0);
    });

    it("should preserve recent retry attempts during cleanup", async () => {
      await recordRetryAttempt("cleanup_test_2", "work_recent", {
        attemptNumber: 1,
        status: "success"
      });

      await cleanupRetryAttempts(30);

      const remaining = await client.query(
        `SELECT * FROM retry_attempts WHERE work_type = $1`,
        ["cleanup_test_2"]
      );

      expect(remaining.rows.length).toBeGreaterThan(0);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete retry → quarantine → recovery flow", async () => {
      const workType = "test_flow";
      const workId = "work_complete_flow";

      // Attempt 1: transient error
      const attempt1 = await handleRetryOrQuarantine(workType, workId, {
        attemptNumber: 1,
        maxAttempts: 2,
        error: new Error("Timeout"),
        errorCode: "408",
        errorMessage: "Request timeout",
        payload: { data: "important" }
      });
      expect(attempt1.action).toBe("retry");

      // Attempt 2: still failing
      const attempt2 = await handleRetryOrQuarantine(workType, workId, {
        attemptNumber: 2,
        maxAttempts: 2,
        error: new Error("Timeout again"),
        errorCode: "408",
        errorMessage: "Request still timing out",
        payload: { data: "important" }
      });
      expect(attempt2.action).toBe("quarantine");
      expect(attempt2.reason).toBe("max_retries_exceeded");

      // Verify quarantine
      const quarantined = await getQuarantineItem(workType, workId);
      expect(quarantined).toBeDefined();
      expect(quarantined.recovery_status).toBe("waiting");

      // Initiate recovery
      const recovery = await initiateRecovery(quarantined.id, {
        operationType: "manual_retry",
        initiatedBy: "ops@example.com"
      });
      expect(recovery).toBeDefined();

      // Mark recovered
      await markRecoverySucceeded(recovery.id, "Fixed and processed");
      const recovered = await getQuarantineItem(workType, workId);
      expect(recovered.recovery_status).toBe("recovered");
    });
  });
});
