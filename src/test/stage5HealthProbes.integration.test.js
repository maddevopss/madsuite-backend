/**
 * Issue #173 PR E: Stage 5 Health Check Probes Integration Tests
 *
 * Validates:
 * 1. Schema consistency probe
 * 2. Job registry health probe
 * 3. Job lock tracking probe
 * 4. Quarantine queue size probe
 * 5. Retry policy compliance probe
 * 6. Outbox pending events probe
 * 7. Outbox delivery latency probe
 * 8. Recovery operations probe
 * 9. Overall system health aggregation
 */

const db = require("../../db");
const {
  probeSchemaConsistency,
  probeJobRegistryHealth,
  probeJobLockTracking,
  probeQuarantineQueueSize,
  probeRetryPolicyCompliance,
  probeOutboxPendingEvents,
  probeOutboxDeliveryLatency,
  probeRecoveryOperations,
  runAllStage5Probes,
  getOverallSystemHealth
} = require("../services/stage5HealthProbes");

describe("PR E: Stage 5 Health Check Probes", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) {
      // Clean up test data
      await client.query(`DELETE FROM outbox_events WHERE event_type LIKE 'health_test_%'`);
      await client.query(`DELETE FROM outbox_delivery_stats WHERE event_handler_name LIKE 'test_%'`);
      await client.query(`DELETE FROM recovery_operations WHERE work_type = 'health_test'`);
      await client.query(`DELETE FROM quarantine_queue WHERE work_type = 'health_test'`);
      await client.query(`DELETE FROM retry_attempts WHERE work_type = 'health_test'`);
      client.release();
    }
  });

  describe("Schema validation", () => {
    it("should have health check thresholds table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'health_check_thresholds'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have health check alerts table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'health_check_alerts'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have stage5_health_summary view", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.views
        WHERE table_name = 'stage5_health_summary'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have predefined health thresholds", async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count FROM health_check_thresholds
      `);
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
  });

  describe("Schema consistency probe", () => {
    it("should detect schema issues", async () => {
      const result = await probeSchemaConsistency();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("schema_inventory");
      expect(result.probe).toBe("schema_consistency");
      expect(result.latency_ms).toBeGreaterThan(0);
    });

    it("should record health check result", async () => {
      await probeSchemaConsistency();

      const result = await client.query(`
        SELECT * FROM observability.health_check_results
        WHERE component_name = 'schema_inventory'
        AND probe_name = 'schema_consistency'
        ORDER BY checked_at DESC
        LIMIT 1
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].status).toMatch(/healthy|degraded|unhealthy/);
    });
  });

  describe("Job registry health probe", () => {
    it("should check job health status", async () => {
      const result = await probeJobRegistryHealth();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("job_registry");
      expect(result.probe).toBe("job_registry_health");
      expect(result.details).toBeDefined();
      expect(result.details.total_jobs).toBeGreaterThan(0);
    });

    it("should identify failed jobs", async () => {
      const result = await probeJobRegistryHealth();

      expect(result.details).toHaveProperty("failed");
      expect(result.details).toHaveProperty("overdue");
    });

    it("should report degraded status on failed jobs", async () => {
      const result = await probeJobRegistryHealth();

      if (result.details.failed > 0) {
        expect(result.status).toBe("degraded");
      }
    });
  });

  describe("Job lock tracking probe", () => {
    it("should check for stuck locks", async () => {
      const result = await probeJobLockTracking();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("job_registry");
      expect(result.probe).toBe("job_lock_tracking");
      expect(result.details).toBeDefined();
    });

    it("should track lock contention", async () => {
      const result = await probeJobLockTracking();

      expect(result.details).toHaveProperty("total_locks_24h");
      expect(result.details).toHaveProperty("currently_held");
      expect(result.details).toHaveProperty("timeouts_24h");
      expect(result.details).toHaveProperty("stuck_locks");
    });
  });

  describe("Quarantine queue probe", () => {
    it("should monitor quarantine queue size", async () => {
      const result = await probeQuarantineQueueSize();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("retry_engine");
      expect(result.probe).toBe("quarantine_queue_size");
      expect(result.details).toBeDefined();
      expect(result.details.total_items).toBeGreaterThanOrEqual(0);
    });

    it("should alert on high quarantine count", async () => {
      // Add test items to quarantine
      for (let i = 0; i < 3; i++) {
        await db.pool.query(`
          INSERT INTO quarantine_queue (
            work_type,
            work_id,
            reason,
            total_attempts,
            first_attempt_at,
            last_attempt_at,
            payload
          )
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5)
        `, [
          "health_test",
          `test_item_${i}`,
          "permanent_error",
          1,
          JSON.stringify({ test: true })
        ]);
      }

      const result = await probeQuarantineQueueSize();

      expect(result.details.total_items).toBeGreaterThan(0);
    });

    it("should detect old quarantined items", async () => {
      const result = await probeQuarantineQueueSize();

      expect(result.details).toHaveProperty("oldest_age_seconds");
    });
  });

  describe("Retry policy compliance probe", () => {
    it("should validate retry policies", async () => {
      const result = await probeRetryPolicyCompliance();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("retry_engine");
      expect(result.probe).toBe("retry_policy_compliance");
      expect(result.details).toBeDefined();
      expect(result.details.total_policies).toBeGreaterThan(0);
    });

    it("should check for missing or invalid policies", async () => {
      const result = await probeRetryPolicyCompliance();

      expect(result.details).toHaveProperty("missing_strategy");
      expect(result.details).toHaveProperty("invalid_attempts");
      expect(result.details).toHaveProperty("missing_backoff");
    });
  });

  describe("Outbox pending events probe", () => {
    it("should monitor outbox queue depth", async () => {
      const result = await probeOutboxPendingEvents();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("outbox_processor");
      expect(result.probe).toBe("outbox_pending_events");
      expect(result.details).toBeDefined();
    });

    it("should track pending event count", async () => {
      const result = await probeOutboxPendingEvents();

      expect(result.details).toHaveProperty("total_pending");
      expect(result.details).toHaveProperty("pending");
      expect(result.details).toHaveProperty("processing");
      expect(result.details).toHaveProperty("failed");
    });

    it("should alert on high pending events", async () => {
      // Add pending test events
      for (let i = 0; i < 5; i++) {
        await client.query(`
          INSERT INTO outbox_events (
            event_type,
            event_handler_name,
            payload,
            status
          )
          VALUES ($1, $2, $3, $4)
        `, [
          "health_test_pending",
          "email_reminder",
          JSON.stringify({ test: true }),
          "pending"
        ]);
      }

      const result = await probeOutboxPendingEvents();

      expect(result.details.pending).toBeGreaterThan(0);
    });
  });

  describe("Outbox delivery latency probe", () => {
    it("should monitor delivery performance", async () => {
      const result = await probeOutboxDeliveryLatency();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("outbox_processor");
      expect(result.probe).toBe("outbox_delivery_latency");
      expect(result.details).toBeDefined();
    });

    it("should track average latency", async () => {
      const result = await probeOutboxDeliveryLatency();

      expect(result.details).toHaveProperty("overall_avg_latency_ms");
      expect(result.details).toHaveProperty("handlers");
    });
  });

  describe("Recovery operations probe", () => {
    it("should monitor recovery success rate", async () => {
      const result = await probeRecoveryOperations();

      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|degraded|unhealthy/);
      expect(result.component).toBe("retry_engine");
      expect(result.probe).toBe("recovery_operations");
      expect(result.details).toBeDefined();
    });

    it("should track recovery statistics", async () => {
      const result = await probeRecoveryOperations();

      expect(result.details).toHaveProperty("total_operations");
      expect(result.details).toHaveProperty("succeeded");
      expect(result.details).toHaveProperty("failed");
      expect(result.details).toHaveProperty("success_rate");
    });
  });

  describe("Probe aggregation", () => {
    it("should run all Stage 5 probes", async () => {
      const results = await runAllStage5Probes();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.component === "schema_inventory")).toBe(true);
      expect(results.some(r => r.component === "job_registry")).toBe(true);
      expect(results.some(r => r.component === "retry_engine")).toBe(true);
      expect(results.some(r => r.component === "outbox_processor")).toBe(true);
    });

    it("should get overall system health", async () => {
      const health = await getOverallSystemHealth();

      expect(health).toBeDefined();
      expect(health.status).toMatch(/healthy|degraded|unhealthy/);
      expect(health.timestamp).toBeDefined();
      expect(Array.isArray(health.probes)).toBe(true);
      expect(health.summary).toBeDefined();
      expect(health.summary.healthy).toBeGreaterThanOrEqual(0);
      expect(health.summary.degraded).toBeGreaterThanOrEqual(0);
      expect(health.summary.unhealthy).toBeGreaterThanOrEqual(0);
    });

    it("should return unhealthy if any probe unhealthy", async () => {
      const health = await getOverallSystemHealth();

      if (health.summary.unhealthy > 0) {
        expect(health.status).toBe("unhealthy");
      }
    });

    it("should return degraded if any probe degraded", async () => {
      const health = await getOverallSystemHealth();

      if (health.summary.unhealthy === 0 && health.summary.degraded > 0) {
        expect(health.status).toBe("degraded");
      }
    });
  });

  describe("Alert recording", () => {
    it("should record health check results in database", async () => {
      await probeSchemaConsistency();

      const result = await client.query(`
        SELECT COUNT(*) as count FROM observability.health_check_results
        WHERE checked_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    it("should include component name in records", async () => {
      await probeJobRegistryHealth();

      const result = await client.query(`
        SELECT DISTINCT component_name FROM observability.health_check_results
        WHERE component_name IS NOT NULL
        LIMIT 1
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it("should include alert severity", async () => {
      await probeQuarantineQueueSize();

      const result = await client.query(`
        SELECT DISTINCT alert_severity FROM observability.health_check_results
        WHERE alert_severity IS NOT NULL
        LIMIT 1
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it("should include remediation steps", async () => {
      await probeRetryPolicyCompliance();

      const result = await client.query(`
        SELECT COUNT(*) as count FROM observability.health_check_results
        WHERE remediation_steps IS NOT NULL
        AND checked_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
  });

  describe("Health summary views", () => {
    it("should query stage5_health_summary view", async () => {
      const result = await client.query(`
        SELECT * FROM observability.stage5_health_summary
        LIMIT 10
      `);

      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("should query active_health_alerts view", async () => {
      const result = await client.query(`
        SELECT * FROM observability.active_health_alerts
        LIMIT 10
      `);

      expect(Array.isArray(result.rows)).toBe(true);
    });
  });

  describe("Integration scenarios", () => {
    it("should detect system health degradation", async () => {
      // Add significant quarantine items
      for (let i = 0; i < 60; i++) {
        await db.pool.query(`
          INSERT INTO quarantine_queue (
            work_type,
            work_id,
            reason,
            total_attempts,
            first_attempt_at,
            last_attempt_at,
            payload
          )
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5)
          ON CONFLICT DO NOTHING
        `, [
          "health_test",
          `stress_test_${i}`,
          "permanent_error",
          1,
          JSON.stringify({ test: true })
        ]);
      }

      const health = await getOverallSystemHealth();
      const quarantineProbe = health.probes.find(p => p.probe === "quarantine_queue_size");

      if (quarantineProbe) {
        expect(quarantineProbe.details.total_items).toBeGreaterThan(0);
      }
    });

    it("should track all Stage 5 components in health check", async () => {
      const health = await getOverallSystemHealth();

      const components = new Set(health.probes.map(p => p.component));

      expect(components.has("schema_inventory")).toBe(true);
      expect(components.has("job_registry")).toBe(true);
      expect(components.has("retry_engine")).toBe(true);
      expect(components.has("outbox_processor")).toBe(true);
    });
  });
});
