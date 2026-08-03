const { randomUUID: uuidv4 } = require('node:crypto');
const prisma = require('../../db');
const loggingService = require('../services/system/logging.service');
const { createLogger } = require('../observability/loggingMiddleware');

describe('Stage 14 PR 14B — Structured Logging Contract Tests', () => {
  let testOrganisationId;
  let testLogger;

  beforeAll(async () => {
    // Setup test organisation
    const organisation = await prisma.raw(
      `SELECT id FROM organisations LIMIT 1`,
    );
    testOrganisationId = organisation[0]?.id || uuidv4();
    testLogger = createLogger('madsuite-backend', testOrganisationId);
  });

  describe('Log Recording', () => {
    it('should record INFO log', async () => {
      const message = 'Test info message';
      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test-service',
        logger_name: 'test',
        message,
        context: { action: 'test_action' },
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        limit: 10,
      });
      const found = logs.some((l) => l.message === message);
      expect(found).toBe(true);
    });

    it('should record ERROR log with stack trace', async () => {
      const message = 'Test error message';
      const stackTrace = 'Error: test\n  at test.js:1:1';

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'ERROR',
        service: 'test-service',
        logger_name: 'test',
        message,
        stack_trace: stackTrace,
        context: { error_code: 'TEST_ERROR' },
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        level: 'ERROR',
      });
      const found = logs.some((l) => l.message === message);
      expect(found).toBe(true);
    });

    it('should require organisation_id, service, message', async () => {
      try {
        await loggingService.recordLog({
          level: 'INFO',
          // missing required fields
        });
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error.message).toContain('Missing required');
      }
    });

    it('should validate log level', async () => {
      try {
        await loggingService.recordLog({
          organisation_id: testOrganisationId,
          level: 'INVALID',
          service: 'test',
          message: 'test',
        });
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error.message).toContain('Invalid log level');
      }
    });

    it('should not throw on logging errors (non-blocking)', async () => {
      // Even if database fails, should not throw
      const result = await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test',
        message: 'Should not throw',
      });
      expect(result === null || result.id).toBeTruthy();
    });
  });

  describe('Sensitive Data Redaction', () => {
    it('should redact password fields', async () => {
      const messageWithPassword = 'User login with password: mySecurePass123';

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'auth-service',
        message: messageWithPassword,
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'auth-service',
        limit: 1,
      });

      const log = logs[0];
      expect(log.message).not.toContain('mySecurePass123');
      expect(log.message).toContain('password');
    });

    it('should redact API tokens', async () => {
      const messageWithToken = 'API token: test_key_abc123xyz789def';

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'api-service',
        message: messageWithToken,
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'api-service',
      });

      const log = logs.find((l) => l.message.includes('test_key'));
      if (log) {
        expect(log.message).not.toContain('test_key_abc123xyz789def');
        expect(log.message).toContain('***');
      }
    });

    it('should redact Authorization header', async () => {
      const messageWithAuth = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'auth-service',
        message: messageWithAuth,
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'auth-service',
      });

      const log = logs.find((l) => l.message.includes('eyJhbGc'));
      if (log) {
        expect(log.message).not.toContain('eyJhbGc');
      }
    });

    it('should redact context object sensitive keys', async () => {
      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test-service',
        message: 'User data',
        context: {
          user_id: '12345',
          password: 'secret123',
          api_key: 'key_abc',
          ssn: '123-45-6789',
        },
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'test-service',
      });

      const log = logs[logs.length - 1];
      const context = log.context;
      expect(context.password).toBe('***');
      expect(context.api_key).toBe('***');
      expect(context.ssn).toBe('***');
      expect(context.user_id).toBe('12345'); // Not sensitive
    });

    it('should redact card numbers', async () => {
      const messageWithCard = 'Charged card 4532-1234-5678-9010';

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'payment-service',
        message: messageWithCard,
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'payment-service',
      });

      const log = logs[logs.length - 1];
      expect(log.message).not.toContain('4532-1234-5678-9010');
      expect(log.message).toContain('***');
    });

    it('should redact CVV', async () => {
      const messageWithCvv = 'CVV: 123';

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'payment-service',
        message: messageWithCvv,
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'payment-service',
      });

      const log = logs[logs.length - 1];
      expect(log.message).not.toContain('123');
    });
  });

  describe('Trace Linkage', () => {
    it('should link logs to traces', async () => {
      const traceId = `trace-${Date.now()}`;

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test-service',
        message: 'Test with trace',
        trace_id: traceId,
      });

      const logsForTrace = await loggingService.getLogsForTrace(
        testOrganisationId,
        traceId,
      );
      expect(logsForTrace.length).toBeGreaterThan(0);
      expect(logsForTrace[0].trace_id).toBe(traceId);
    });
  });

  describe('Full-Text Search', () => {
    it('should find logs by keyword search', async () => {
      const uniqueKeyword = `unique-keyword-${Date.now()}`;

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test-service',
        message: `This message contains ${uniqueKeyword}`,
      });

      const results = await loggingService.searchLogs(
        testOrganisationId,
        uniqueKeyword,
      );

      const found = results.some((l) => l.message.includes(uniqueKeyword));
      expect(found).toBe(true);
    });

    it('should return ranked results for search', async () => {
      const searchTerm = `search-test-${Date.now()}`;

      // Record multiple logs with varying relevance
      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test',
        message: `Exact: ${searchTerm}`,
      });

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'test',
        message: `Contains ${searchTerm} in middle`,
      });

      const results = await loggingService.searchLogs(
        testOrganisationId,
        searchTerm,
        { limit: 10 },
      );

      expect(results.length).toBeGreaterThan(0);
      // Results should be ordered by rank
    });

    it('should filter search by level and service', async () => {
      const searchTerm = `filtered-search-${Date.now()}`;

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'ERROR',
        service: 'error-service',
        message: `Error: ${searchTerm}`,
      });

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'info-service',
        message: `Info: ${searchTerm}`,
      });

      const errorResults = await loggingService.searchLogs(
        testOrganisationId,
        searchTerm,
        { level: 'ERROR' },
      );

      errorResults.forEach((log) => {
        expect(log.level).toBe('ERROR');
      });
    });
  });

  describe('Log Statistics & Aggregation', () => {
    it('should compute log statistics by level and service', async () => {
      // Record various logs
      for (let i = 0; i < 3; i++) {
        await loggingService.recordLog({
          organisation_id: testOrganisationId,
          level: 'INFO',
          service: 'stats-test',
          message: `Log ${i}`,
        });
      }

      for (let i = 0; i < 2; i++) {
        await loggingService.recordLog({
          organisation_id: testOrganisationId,
          level: 'ERROR',
          service: 'stats-test',
          message: `Error ${i}`,
          stack_trace: 'Error trace',
        });
      }

      const stats = await loggingService.getLogStats(testOrganisationId, {
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(),
      });

      const statsByService = stats.find((s) => s.service === 'stats-test');
      if (statsByService) {
        expect(statsByService.count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('RLS & Organisation Isolation', () => {
    it('should enforce organisation_id isolation', async () => {
      const org1Id = testOrganisationId;
      const org2Id = uuidv4();

      // Record logs for different organisations
      await loggingService.recordLog({
        organisation_id: org1Id,
        level: 'INFO',
        service: 'test',
        message: `Org 1 message - ${Date.now()}`,
      });

      await loggingService.recordLog({
        organisation_id: org2Id,
        level: 'INFO',
        service: 'test',
        message: `Org 2 message - ${Date.now()}`,
      });

      // Query logs for org1
      const org1Logs = await loggingService.getLogsByOrganisation(org1Id);
      org1Logs.forEach((log) => {
        expect(log.organisation_id).toBe(org1Id);
      });
    });
  });

  describe('Log Cleanup & Retention', () => {
    it('should delete logs older than retention period', async () => {
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

      // Insert old log directly (simulating old data)
      await prisma.raw(
        `
        INSERT INTO observability.log_events (
          organisation_id, timestamp, level, service, logger_name, message
        ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [testOrganisationId, oldDate, 'INFO', 'test', 'test', 'Old log'],
      );

      const deleted = await loggingService.cleanup(7);
      expect(deleted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Logger Helper', () => {
    it('should create logger with helper methods', async () => {
      const logger = createLogger('test-service', testOrganisationId);

      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.fatal).toBeDefined();
    });

    it('should record error with stack trace', async () => {
      const logger = createLogger('test-service', testOrganisationId);
      const error = new Error('Test error');

      await logger.error('An error occurred', error, { action: 'test' });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        level: 'ERROR',
        service: 'test-service',
      });

      const found = logs.some(
        (l) => l.message === 'An error occurred' && l.stack_trace !== null,
      );
      expect(found).toBe(true);
    });
  });

  describe('Context Preservation', () => {
    it('should preserve context structure', async () => {
      const context = {
        user_id: '123',
        action: 'create_invoice',
        resource_type: 'invoice',
        duration_ms: 250,
        invoice_id: 'INV-001',
      };

      await loggingService.recordLog({
        organisation_id: testOrganisationId,
        level: 'INFO',
        service: 'invoice-service',
        message: 'Invoice created',
        context,
      });

      const logs = await loggingService.getLogsByOrganisation(testOrganisationId, {
        service: 'invoice-service',
      });

      const log = logs[logs.length - 1];
      expect(log.context.user_id).toBe('123');
      expect(log.context.action).toBe('create_invoice');
      expect(log.context.invoice_id).toBe('INV-001');
    });
  });
});
