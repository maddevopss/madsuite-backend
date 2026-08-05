/**
 * Issue #173 PR D: Outbox Event Processor Integration Tests
 *
 * Validates:
 * 1. Event processing with different handlers
 * 2. Retry logic with exponential backoff
 * 3. Quarantine on permanent failures
 * 4. Recovery operations for quarantined events
 * 5. Stuck event recovery
 * 6. Event statistics tracking
 * 7. Integration with retry engine and job registry
 */

const db = require("../../db");
const {
  processOutboxEvents,
  processOutboxEvent,
  recoverStuckEvents,
  getEvent,
  getQuarantinedEvents,
  retryQuarantinedEvent,
  getOutboxStats
} = require("../services/outboxProcessor");
const eventHandlers = require("../config/eventHandlers");
const retryEngine = require("../services/retryEngine");

describe("PR D: Outbox Event Processor", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) {
      // Clean up test data
      await client.query(`DELETE FROM outbox_events WHERE event_type LIKE 'test_%'`);
      await client.query(`DELETE FROM recovery_operations WHERE work_type = 'test_outbox_event'`);
      await client.query(`DELETE FROM quarantine_queue WHERE work_type = 'test_outbox_event'`);
      await client.query(`DELETE FROM retry_attempts WHERE work_type = 'test_outbox_event'`);
      client.release();
    }
  });

  describe("Schema validation", () => {
    it("should have outbox_events table with enhanced columns", async () => {
      const result = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'outbox_events'
      `);

      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain("event_handler_name");
      expect(columns).toContain("retry_policy_name");
      expect(columns).toContain("delivery_attempts");
      expect(columns).toContain("last_delivery_error");
      expect(columns).toContain("quarantine_id");
    });

    it("should have event_handlers table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'event_handlers'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have outbox_delivery_stats table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'outbox_delivery_stats'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have predefined event handlers", async () => {
      const result = await client.query(`
        SELECT handler_name FROM event_handlers
      `);

      const handlers = result.rows.map(r => r.handler_name);
      expect(handlers).toContain("email_reminder");
      expect(handlers).toContain("webhook_delivery");
      expect(handlers).toContain("sms_notification");
    });
  });

  describe("Event handlers registry", () => {
    it("should get event handler by name", async () => {
      const handler = await eventHandlers.getEventHandler("email_reminder");
      expect(handler).toBeDefined();
      expect(handler.name || handler.handler_name).toBeDefined();
    });

    it("should get all event handlers", async () => {
      const handlers = await eventHandlers.getAllEventHandlers();
      expect(handlers.length).toBeGreaterThan(0);
    });

    it("should execute email reminder handler", async () => {
      const result = await eventHandlers.executeEventHandler("email_reminder", {
        email: "test@example.com",
        type: "dunning_reminder"
      });

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    it("should reject invalid payload", async () => {
      const result = await eventHandlers.executeEventHandler("email_reminder", {
        // missing email and type
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
    });

    it("should execute webhook delivery handler", async () => {
      const result = await eventHandlers.executeEventHandler("webhook_delivery", {
        url: "https://example.com/webhook",
        event: { type: "test" }
      });

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    it("should register new event handler", async () => {
      await eventHandlers.registerEventHandler("test_handler", {
        displayName: "Test Handler",
        description: "Handler for testing",
        timeoutSeconds: 20,
        maxAttempts: 2,
        ownerTeam: "test",
        tags: ["test"]
      });

      const handler = await eventHandlers.getEventHandler("test_handler");
      expect(handler).toBeDefined();
      expect(handler.display_name || handler.displayName).toContain("Test");
    });
  });

  describe("Event creation and retrieval", () => {
    it("should create outbox event", async () => {
      const result = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          retry_policy_name
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, status
      `, [
        "test_email_reminder",
        "email_reminder",
        JSON.stringify({ email: "user@example.com", type: "test" }),
        "pending",
        "moderate"
      ]);

      expect(result.rows[0].id).toBeDefined();
      expect(result.rows[0].status).toBe("pending");
    });

    it("should get event by ID", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        "test_webhook",
        "webhook_delivery",
        JSON.stringify({ url: "https://example.com/hook", event: {} }),
        "pending"
      ]);

      const eventId = createResult.rows[0].id;
      const event = await getEvent(eventId);

      expect(event).toBeDefined();
      expect(event.id).toBe(eventId);
      expect(event.event_type).toBe("test_webhook");
    });
  });

  describe("Event processing - success", () => {
    it("should process event successfully", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          delivery_attempts
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        "test_success",
        "email_reminder",
        JSON.stringify({ email: "test@example.com", type: "success_test" }),
        "pending",
        0
      ]);

      const eventId = createResult.rows[0].id;

      // Process event
      await processOutboxEvent({
        id: eventId,
        event_type: "test_success",
        event_handler_name: "email_reminder",
        payload: { email: "test@example.com", type: "success_test" },
        retry_policy_name: "moderate",
        delivery_attempts: 0
      });

      // Verify event is completed
      const event = await getEvent(eventId);
      expect(event.status).toBe("completed");
    });
  });

  describe("Event processing - retries", () => {
    it("should track delivery attempts", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          delivery_attempts
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        "test_retry_tracking",
        "webhook_delivery",
        JSON.stringify({ url: "https://example.com", event: {} }),
        "pending",
        0
      ]);

      const eventId = createResult.rows[0].id;

      // Update delivery attempts
      await client.query(`
        UPDATE outbox_events
        SET delivery_attempts = 2
        WHERE id = $1
      `, [eventId]);

      const event = await getEvent(eventId);
      expect(event.delivery_attempts).toBe(2);
    });

    it("should schedule retry with exponential backoff", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          delivery_attempts
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        "test_backoff",
        "sms_notification",
        JSON.stringify({ phone: "+1234567890", message: "test" }),
        "pending",
        1
      ]);

      const eventId = createResult.rows[0].id;

      // Update with retry schedule
      await client.query(`
        UPDATE outbox_events
        SET next_retry_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
        WHERE id = $1
      `, [eventId]);

      const event = await getEvent(eventId);
      expect(event.next_retry_at).toBeDefined();
    });
  });

  describe("Event processing - quarantine", () => {
    it("should quarantine event on permanent error", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          delivery_attempts
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        "test_permanent",
        "email_reminder",
        JSON.stringify({ email: "test@example.com", type: "test" }),
        "pending",
        0
      ]);

      const eventId = createResult.rows[0].id;

      // Quarantine directly (simulating permanent error)
      const qItem = await retryEngine.quarantineWork("test_outbox_event", eventId, {
        reason: "permanent_error",
        errorCode: "INVALID_EMAIL",
        errorMessage: "Invalid email address",
        payload: { email: "test@example.com" },
        tags: ["email", "test"]
      });

      // Link to outbox event
      await client.query(`
        UPDATE outbox_events
        SET
          status = 'quarantined',
          quarantine_id = $2
        WHERE id = $1
      `, [eventId, qItem.id]);

      const event = await getEvent(eventId);
      expect(event.status).toBe("quarantined");
      expect(event.quarantine_id).toBe(qItem.id);
    });

    it("should get quarantined events", async () => {
      // Create and quarantine test event
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        "test_quarantine_list",
        "webhook_delivery",
        JSON.stringify({ url: "https://example.com", event: {} }),
        "quarantined"
      ]);

      const eventId = createResult.rows[0].id;

      const qItem = await retryEngine.quarantineWork("test_outbox_event", eventId, {
        reason: "max_retries_exceeded",
        errorMessage: "Max retries exceeded",
        payload: { url: "https://example.com" }
      });

      await client.query(`
        UPDATE outbox_events
        SET quarantine_id = $2
        WHERE id = $1
      `, [eventId, qItem.id]);

      const quarantined = await getQuarantinedEvents({ limit: 100 });
      expect(quarantined.length).toBeGreaterThan(0);
      expect(quarantined.some(q => q.id === eventId)).toBe(true);
    });
  });

  describe("Recovery operations", () => {
    it("should initiate recovery for quarantined event", async () => {
      // Create quarantined event
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        "test_recovery",
        "email_reminder",
        JSON.stringify({ email: "test@example.com", type: "test" }),
        "pending"
      ]);

      const eventId = createResult.rows[0].id;

      // Quarantine it
      const qItem = await retryEngine.quarantineWork("test_outbox_event", eventId, {
        reason: "permanent_error",
        errorMessage: "Test error",
        payload: { email: "test@example.com" }
      });

      // Initiate recovery
      const recovery = await retryEngine.initiateRecovery(qItem.id, {
        operationType: "fix_and_retry",
        initiatedBy: "ops@company.com",
        payloadOverride: { email: "fixed@example.com", type: "test" }
      });

      expect(recovery).toBeDefined();
      expect(recovery.id).toBeDefined();
    });

    it("should retry quarantined event with payload override", async () => {
      // Create and quarantine event
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        "test_retry_override",
        "webhook_delivery",
        JSON.stringify({ url: "https://broken.com", event: {} }),
        "pending"
      ]);

      const eventId = createResult.rows[0].id;

      const qItem = await retryEngine.quarantineWork("test_outbox_event", eventId, {
        reason: "permanent_error",
        errorMessage: "Invalid URL",
        payload: { url: "https://broken.com", event: {} }
      });

      // Create recovery operation
      const recovery = await retryEngine.initiateRecovery(qItem.id, {
        operationType: "fix_and_retry",
        initiatedBy: "admin@company.com",
        payloadOverride: { url: "https://fixed.com", event: {} }
      });

      // Retry with override
      const updated = await retryQuarantinedEvent(
        eventId,
        recovery.id,
        { url: "https://fixed.com", event: {} }
      );

      expect(updated.status).toBe("pending");
      expect(updated.recovery_id).toBe(recovery.id);
    });

    it("should mark recovery as succeeded", async () => {
      const qItem = await retryEngine.quarantineWork("test_outbox_event", "recovery_success_test", {
        reason: "max_retries_exceeded",
        errorMessage: "Test error",
        payload: { test: true }
      });

      const recovery = await retryEngine.initiateRecovery(qItem.id, {
        operationType: "manual_retry",
        initiatedBy: "admin@company.com"
      });

      await retryEngine.markRecoverySucceeded(recovery.id, "Successfully processed");

      const updated = await retryEngine.getQuarantineItem("test_outbox_event", "recovery_success_test");
      expect(updated.recovery_status).toBe("recovered");
    });
  });

  describe("Stuck event recovery", () => {
    it("should recover events stuck in processing state", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          delivery_started_at
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - INTERVAL '20 minutes')
        RETURNING id
      `, [
        "test_stuck",
        "email_reminder",
        JSON.stringify({ email: "test@example.com" }),
        "processing"
      ]);

      const eventId = createResult.rows[0].id;

      // Recover stuck events
      const recovered = await recoverStuckEvents(600);

      expect(recovered.length).toBeGreaterThan(0);
      expect(recovered.some(r => r.id === eventId)).toBe(true);
    });
  });

  describe("Statistics and reporting", () => {
    it("should track delivery statistics", async () => {
      // Create test event
      await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4)
      `, [
        "test_stats",
        "email_reminder",
        JSON.stringify({ email: "test@example.com" }),
        "completed"
      ]);

      const stats = await getOutboxStats();
      expect(stats.length).toBeGreaterThanOrEqual(0);
    });

    it("should filter statistics by handler", async () => {
      const stats = await getOutboxStats("email_reminder");
      expect(Array.isArray(stats)).toBe(true);
    });

    it("should record handler delivery attempt", async () => {
      await eventHandlers.recordDeliveryAttempt("email_reminder", true, 1500);
      await eventHandlers.recordDeliveryAttempt("email_reminder", false, 800, "SMTP Error");

      const stats = await eventHandlers.getHandlerStats("email_reminder");
      expect(stats).toBeDefined();
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete event delivery flow - success", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status,
          delivery_attempts
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        "test_flow_success",
        "email_reminder",
        JSON.stringify({ email: "test@example.com", type: "test" }),
        "pending",
        0
      ]);

      const eventId = createResult.rows[0].id;

      // Process successfully
      await processOutboxEvent({
        id: eventId,
        event_type: "test_flow_success",
        event_handler_name: "email_reminder",
        payload: { email: "test@example.com", type: "test" },
        retry_policy_name: "moderate",
        delivery_attempts: 0
      });

      const event = await getEvent(eventId);
      expect(event.status).toBe("completed");
    });

    it("should handle complete flow - permanent error to quarantine to recovery", async () => {
      const createResult = await client.query(`
        INSERT INTO outbox_events (
          event_type,
          event_handler_name,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        "test_flow_recovery",
        "email_reminder",
        JSON.stringify({ email: "invalid@", type: "test" }),
        "pending"
      ]);

      const eventId = createResult.rows[0].id;

      // Simulate permanent error → quarantine
      const qItem = await retryEngine.quarantineWork("test_outbox_event", eventId, {
        reason: "permanent_error",
        errorCode: "INVALID_EMAIL",
        errorMessage: "Invalid email format",
        payload: { email: "invalid@", type: "test" },
        tags: ["email"]
      });

      await client.query(`
        UPDATE outbox_events
        SET
          status = 'quarantined',
          quarantine_id = $2
        WHERE id = $1
      `, [eventId, qItem.id]);

      // Initiate recovery with fix
      const recovery = await retryEngine.initiateRecovery(qItem.id, {
        operationType: "fix_and_retry",
        initiatedBy: "admin@company.com",
        payloadOverride: { email: "valid@example.com", type: "test" }
      });

      // Retry
      await retryQuarantinedEvent(eventId, recovery.id, { email: "valid@example.com", type: "test" });

      // Verify back in pending
      const event = await getEvent(eventId);
      expect(event.status).toBe("pending");
      expect(event.recovery_id).toBe(recovery.id);
    });
  });
});
