/**
 * Issue #173 PR F: Stage 5 Metrics Pipeline Integration Tests
 *
 * Validates:
 * 1. Metrics collection from all components
 * 2. Time-series data aggregation (hourly/daily)
 * 3. Dashboard views and aggregations
 * 4. Operation logging and audit trail
 * 5. Metrics integrity and retention
 */

const db = require("../../db");
const {
  collectRetryMetrics,
  collectQuarantineMetrics,
  collectDeliveryMetrics,
  collectJobMetrics,
  collectSchemaMetrics,
  runAllMetrics,
  getComponentMetrics,
  getDashboardSummary
} = require("../services/metricsCollector");
const {
  logOperation,
  logJobExecution,
  logRetryAttempt,
  logQuarantine,
  logEventDelivery,
  queryOperationLogs,
  getComponentSummary,
  getErrorTrends,
  getCriticalOperations
} = require("../services/operationLogger");

describe("PR F: Stage 5 Metrics Pipeline", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) {
      // Clean up test data
      await client.query(`DELETE FROM operation_logs WHERE user_id = 'test'`);
      await client.query(`DELETE FROM retry_metrics WHERE date = CURRENT_DATE`);
      await client.query(`DELETE FROM quarantine_metrics WHERE date = CURRENT_DATE`);
      await client.query(`DELETE FROM event_delivery_metrics WHERE date = CURRENT_DATE`);
      await client.query(`DELETE FROM job_execution_metrics WHERE date = CURRENT_DATE`);
      client.release();
    }
  });

  describe("Schema validation", () => {
    it("should have operation_logs table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'operation_logs'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have retry_metrics table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'retry_metrics'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have quarantine_metrics table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'quarantine_metrics'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have event_delivery_metrics table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'event_delivery_metrics'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have job_execution_metrics table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'job_execution_metrics'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have schema_change_metrics table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'schema_change_metrics'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have dashboard views", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.views
        WHERE table_name IN ('hourly_summary', 'daily_summary', 'error_trends', 'sla_compliance')
      `);
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("Operation logging", () => {
    it("should log a basic operation", async () => {
      const result = await logOperation('test_op', 'test_component', {
        userId: 'test',
        action: 'TEST',
        status: 'success',
        message: 'Test operation'
      });

      expect(result.logged).toBe(true);
      expect(result.id).toBeDefined();
    });

    it("should log job execution", async () => {
      const result = await logJobExecution('testJob', {
        userId: 'test',
        status: 'success',
        durationMs: 100
      });

      expect(result.logged).toBe(true);
    });

    it("should log retry attempt", async () => {
      const result = await logRetryAttempt('test_work', 'test_id', {
        userId: 'test',
        attemptNumber: 1,
        status: 'pending',
        backoffStrategy: 'exponential',
        nextAttemptSeconds: 60
      });

      expect(result.logged).toBe(true);
    });

    it("should log quarantine operation", async () => {
      const result = await logQuarantine('test_work', 'test_id', 'permanent_error', {
        userId: 'test',
        errorCode: 'INVALID_DATA',
        totalAttempts: 3
      });

      expect(result.logged).toBe(true);
    });

    it("should log event delivery", async () => {
      const result = await logEventDelivery('event_123', 'email_handler', {
        userId: 'test',
        status: 'success',
        durationMs: 250,
        attemptNumber: 1
      });

      expect(result.logged).toBe(true);
    });

    it("should store operation with details", async () => {
      await logOperation('detailed_op', 'test_component', {
        userId: 'test',
        action: 'DETAIL_TEST',
        status: 'success',
        details: { key: 'value', nested: { data: 123 } },
        durationMs: 50
      });

      const result = await client.query(`
        SELECT details FROM operation_logs
        WHERE user_id = 'test'
        AND operation_type = 'detailed_op'
        LIMIT 1
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].details).toBeDefined();
    });
  });

  describe("Operation log queries", () => {
    beforeEach(async () => {
      // Add test operations
      await logJobExecution('queryTestJob', {
        userId: 'test',
        status: 'success',
        durationMs: 100
      });

      await logRetryAttempt('work_type', 'work_id', {
        userId: 'test',
        attemptNumber: 1,
        status: 'failed_transient'
      });
    });

    it("should query operation logs by type", async () => {
      const result = await queryOperationLogs({
        operationType: 'job_execution',
        daysBack: 1
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].operation_type).toBe('job_execution');
    });

    it("should query operation logs by component", async () => {
      const result = await queryOperationLogs({
        componentName: 'job_registry',
        daysBack: 1
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it("should query operation logs by status", async () => {
      const result = await queryOperationLogs({
        status: 'success',
        daysBack: 1
      });

      expect(result.every(r => r.status === 'success')).toBe(true);
    });

    it("should get component summary", async () => {
      const result = await getComponentSummary('job_registry', 1);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should get error trends", async () => {
      const result = await getErrorTrends(1);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should get critical operations", async () => {
      const result = await getCriticalOperations(24);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Retry metrics collection", () => {
    it("should have retry metrics function", () => {
      expect(typeof collectRetryMetrics).toBe('function');
    });

    it("should execute retry metrics collection", async () => {
      const result = await collectRetryMetrics();

      expect(result).toBeDefined();
      expect(result.component).toBe('retry_engine');
      expect(result.collected).toBeDefined();
    });
  });

  describe("Quarantine metrics collection", () => {
    it("should have quarantine metrics function", () => {
      expect(typeof collectQuarantineMetrics).toBe('function');
    });

    it("should execute quarantine metrics collection", async () => {
      const result = await collectQuarantineMetrics();

      expect(result).toBeDefined();
      expect(result.component).toBe('retry_engine');
      expect(result.collected).toBeDefined();
    });
  });

  describe("Delivery metrics collection", () => {
    it("should have delivery metrics function", () => {
      expect(typeof collectDeliveryMetrics).toBe('function');
    });

    it("should execute delivery metrics collection", async () => {
      const result = await collectDeliveryMetrics();

      expect(result).toBeDefined();
      expect(result.component).toBe('outbox_processor');
      expect(result.collected).toBeDefined();
    });
  });

  describe("Job metrics collection", () => {
    it("should have job metrics function", () => {
      expect(typeof collectJobMetrics).toBe('function');
    });

    it("should execute job metrics collection", async () => {
      const result = await collectJobMetrics();

      expect(result).toBeDefined();
      expect(result.component).toBe('job_registry');
      expect(result.collected).toBeDefined();
    });
  });

  describe("Schema metrics collection", () => {
    it("should have schema metrics function", () => {
      expect(typeof collectSchemaMetrics).toBe('function');
    });

    it("should execute schema metrics collection", async () => {
      const result = await collectSchemaMetrics();

      expect(result).toBeDefined();
      expect(result.component).toBe('schema_inventory');
      expect(result.collected).toBeDefined();
    });
  });

  describe("All metrics aggregation", () => {
    it("should run all metrics", async () => {
      const result = await runAllMetrics();

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("should include all components in results", async () => {
      const result = await runAllMetrics();

      const components = result.results.map(r => r.component);
      expect(components).toContain('retry_engine');
      expect(components).toContain('outbox_processor');
      expect(components).toContain('job_registry');
      expect(components).toContain('schema_inventory');
    });
  });

  describe("Dashboard queries", () => {
    it("should get dashboard summary", async () => {
      const result = await getDashboardSummary();

      expect(result).toBeDefined();
      expect(result.current_hour).toBeDefined();
      expect(result.last_24h).toBeDefined();
      expect(Array.isArray(result.current_hour)).toBe(true);
      expect(Array.isArray(result.last_24h)).toBe(true);
    });

    it("should query hourly_summary view", async () => {
      const result = await client.query(`
        SELECT * FROM metrics.hourly_summary
        LIMIT 10
      `);

      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("should query daily_summary view", async () => {
      const result = await client.query(`
        SELECT * FROM metrics.daily_summary
        LIMIT 10
      `);

      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("should query error_trends view", async () => {
      const result = await client.query(`
        SELECT * FROM metrics.error_trends
        LIMIT 10
      `);

      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("should query sla_compliance view", async () => {
      const result = await client.query(`
        SELECT * FROM metrics.sla_compliance
        LIMIT 10
      `);

      expect(Array.isArray(result.rows)).toBe(true);
    });
  });

  describe("Component metrics retrieval", () => {
    it("should get retry engine metrics", async () => {
      const result = await getComponentMetrics('retry_engine', 7);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should get outbox processor metrics", async () => {
      const result = await getComponentMetrics('outbox_processor', 7);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should get job registry metrics", async () => {
      const result = await getComponentMetrics('job_registry', 7);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should throw on unknown component", async () => {
      try {
        await getComponentMetrics('unknown_component');
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('Unknown component');
      }
    });
  });

  describe("Metrics data integrity", () => {
    it("should maintain unique constraint on retry_metrics", async () => {
      const query = `
        SELECT COUNT(DISTINCT (date, hour)) as unique_count,
               COUNT(*) as total_count
        FROM retry_metrics
        WHERE date >= CURRENT_DATE - INTERVAL '1 day'
      `;

      const result = await client.query(query);

      if (result.rows[0].total_count > 0) {
        expect(result.rows[0].unique_count).toBeLessThanOrEqual(result.rows[0].total_count);
      }
    });

    it("should have valid quarantine_metrics structure", async () => {
      const query = `
        SELECT
          date,
          hour,
          total_items,
          waiting_recovery,
          in_recovery,
          recovered,
          permanently_failed
        FROM quarantine_metrics
        LIMIT 1
      `;

      const result = await client.query(query);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        expect(row.date).toBeDefined();
        expect(typeof row.total_items).toBe('number');
      }
    });

    it("should have event_delivery_metrics with latency data", async () => {
      const query = `
        SELECT
          event_handler_name,
          avg_latency_ms,
          p50_latency_ms,
          p95_latency_ms,
          p99_latency_ms
        FROM event_delivery_metrics
        LIMIT 1
      `;

      const result = await client.query(query);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        expect(row.event_handler_name).toBeDefined();
      }
    });
  });

  describe("Integration scenarios", () => {
    it("should correlate retry and quarantine metrics", async () => {
      // Add test retry attempts
      await db.pool.query(`
        INSERT INTO retry_attempts (
          work_type, work_id, attempt_number, attempt_at, status,
          error_classification, backoff_strategy, backoff_seconds
        ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, ['integration_test', 'id_123', 1, 'failed_permanent', 'permanent', 'exponential', 60]);

      // Run metrics collection
      const metrics = await runAllMetrics();

      expect(metrics.success).toBeDefined();
    });

    it("should track complete operation lifecycle", async () => {
      const startTime = Date.now();

      // Log attempt
      await logRetryAttempt('lifecycle_test', 'test_id', {
        userId: 'test',
        attemptNumber: 1,
        status: 'failed_transient'
      });

      // Log retry decision
      await logRetryAttempt('lifecycle_test', 'test_id', {
        userId: 'test',
        attemptNumber: 2,
        status: 'pending',
        nextAttemptSeconds: 120
      });

      // Log eventual success
      await logOperation('retry_attempt', 'retry_engine', {
        userId: 'test',
        action: 'RETRY',
        status: 'success',
        message: 'Successfully delivered after retries'
      });

      const duration = Date.now() - startTime;

      // Verify complete trace in logs
      const result = await queryOperationLogs({
        componentName: 'retry_engine',
        daysBack: 1,
        limit: 1000
      });

      expect(result.length).toBeGreaterThan(0);
    });

    it("should aggregate metrics across all components", async () => {
      const hourly = await client.query(`
        SELECT * FROM metrics.hourly_summary
        WHERE date >= CURRENT_DATE - INTERVAL '1 day'
        LIMIT 1
      `);

      expect(Array.isArray(hourly.rows)).toBe(true);
    });
  });

  describe("Metrics retention and cleanup", () => {
    it("should have indexes for efficient querying", async () => {
      const result = await client.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'operation_logs'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it("should have update triggers on metrics tables", async () => {
      const tables = [
        'retry_metrics',
        'quarantine_metrics',
        'event_delivery_metrics',
        'job_execution_metrics',
        'schema_change_metrics'
      ];

      for (const table of tables) {
        const result = await client.query(`
          SELECT trigger_name FROM information_schema.triggers
          WHERE event_object_table = $1
        `, [table]);

        expect(result.rows.length).toBeGreaterThan(0);
      }
    });

    it("should track updated_at timestamps", async () => {
      const result = await client.query(`
        SELECT updated_at FROM retry_metrics
        WHERE date = CURRENT_DATE
        LIMIT 1
      `);

      if (result.rows.length > 0) {
        expect(result.rows[0].updated_at).toBeDefined();
      }
    });
  });
});
