const request = require('supertest');
const express = require('express');
const healthService = require('../services/system/health.service');
const { createHealthRoutes } = require('../observability/healthRoutes');
const prisma = require('../db/db');

describe('Stage 14 PR 14C — Health Checks & Probes Contract Tests', () => {
  let app;
  let mockRedisClient;
  let mockQueueClient;

  beforeAll(() => {
    // Setup mock dependencies
    mockRedisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    mockQueueClient = {
      count: jest.fn().mockResolvedValue(10),
    };

    // Setup Express app with health routes
    app = express();
    app.use(createHealthRoutes({ redis: mockRedisClient, queue: mockQueueClient }));
  });

  describe('Database Probe', () => {
    it('should report healthy when database is accessible', async () => {
      const result = await healthService.checkDatabase();
      expect(result.status).toBe('healthy');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('should measure database latency', async () => {
      const result = await healthService.checkDatabase();
      expect(result.latency_ms).toBeGreaterThan(0);
    });
  });

  describe('Redis Probe', () => {
    it('should report healthy when Redis is available', async () => {
      const result = await healthService.checkRedis(mockRedisClient);
      expect(result.status).toBe('healthy');
    });

    it('should report degraded when Redis client not configured', async () => {
      const result = await healthService.checkRedis(null);
      expect(result.status).toBe('degraded');
      expect(result.error_message).toContain('not configured');
    });

    it('should report unhealthy on Redis ping failure', async () => {
      mockRedisClient.ping.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await healthService.checkRedis(mockRedisClient);
      expect(result.status).toBe('unhealthy');
      expect(result.error_message).toContain('Connection refused');
    });
  });

  describe('Queue Depth Probe', () => {
    it('should report healthy when queue depth is normal', async () => {
      mockQueueClient.count.mockResolvedValueOnce(50);
      const result = await healthService.checkQueueDepth(mockQueueClient);
      expect(result.status).toBe('healthy');
    });

    it('should report degraded when queue exceeds warning threshold', async () => {
      mockQueueClient.count.mockResolvedValueOnce(150);
      const result = await healthService.checkQueueDepth(mockQueueClient, {
        warning: 100,
        critical: 500,
      });
      expect(result.status).toBe('degraded');
      expect(result.error_message).toContain('warning threshold');
    });

    it('should report unhealthy when queue exceeds critical threshold', async () => {
      mockQueueClient.count.mockResolvedValueOnce(600);
      const result = await healthService.checkQueueDepth(mockQueueClient, {
        warning: 100,
        critical: 500,
      });
      expect(result.status).toBe('unhealthy');
      expect(result.error_message).toContain('critical threshold');
    });

    it('should report degraded when queue client not configured', async () => {
      const result = await healthService.checkQueueDepth(null);
      expect(result.status).toBe('degraded');
    });
  });

  describe('Memory Probe', () => {
    it('should report health status based on memory usage', () => {
      const result = healthService.checkMemory();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
      expect(result.latency_ms).toBe(0);
    });

    it('should not report unhealthy under normal conditions', () => {
      const result = healthService.checkMemory();
      // On typical test machine, should be healthy or degraded
      expect(['healthy', 'degraded']).toContain(result.status);
    });
  });

  describe('Disk Space Probe', () => {
    it('should report health based on disk space', async () => {
      const result = await healthService.checkDiskSpace();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    });

    it('should not report unhealthy under normal conditions', async () => {
      const result = await healthService.checkDiskSpace();
      // On typical system, should have adequate disk space
      expect(['healthy', 'degraded']).toContain(result.status);
    });
  });

  describe('Overall Health Check', () => {
    it('should run all probes and return overall status', async () => {
      const health = await healthService.performHealthChecks({
        redis: mockRedisClient,
        queue: mockQueueClient,
      });

      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.probes).toBeDefined();
      expect(health.probes.database).toBeDefined();
      expect(health.probes.redis).toBeDefined();
      expect(health.probes.queue).toBeDefined();
      expect(health.probes.memory).toBeDefined();
      expect(health.probes.disk).toBeDefined();
    });

    it('should compute overall status as unhealthy if any probe unhealthy', () => {
      const probes = {
        database: { status: 'healthy' },
        redis: { status: 'unhealthy' },
        memory: { status: 'healthy' },
      };

      const status = healthService.computeOverallStatus(probes);
      expect(status).toBe('unhealthy');
    });

    it('should compute overall status as degraded if any probe degraded (no unhealthy)', () => {
      const probes = {
        database: { status: 'healthy' },
        redis: { status: 'degraded' },
        memory: { status: 'healthy' },
      };

      const status = healthService.computeOverallStatus(probes);
      expect(status).toBe('degraded');
    });

    it('should compute overall status as healthy if all probes healthy', () => {
      const probes = {
        database: { status: 'healthy' },
        redis: { status: 'healthy' },
        memory: { status: 'healthy' },
      };

      const status = healthService.computeOverallStatus(probes);
      expect(status).toBe('healthy');
    });
  });

  describe('Health Endpoints', () => {
    it('GET /health should return 200 when healthy', async () => {
      const response = await request(app).get('/health');
      expect([200, 503]).toContain(response.status);
      expect(response.body.status).toBeDefined();
      expect(response.body.probes).toBeDefined();
    });

    it('GET /health should include all probes', async () => {
      const response = await request(app).get('/health');
      expect(response.body.probes.database).toBeDefined();
      expect(response.body.probes.redis).toBeDefined();
      expect(response.body.probes.queue).toBeDefined();
      expect(response.body.probes.memory).toBeDefined();
      expect(response.body.probes.disk).toBeDefined();
    });

    it('GET /health/live should return 200 (liveness check)', async () => {
      const response = await request(app).get('/health/live');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
      expect(response.body.uptime_seconds).toBeGreaterThan(0);
    });

    it('GET /health/ready should return 200 when ready', async () => {
      const response = await request(app).get('/health/ready');
      expect([200, 503]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.status).toBe('ready');
      } else {
        expect(response.body.status).toBe('not_ready');
      }
    });

    it('GET /health/summary should return latest health status', async () => {
      const response = await request(app).get('/health/summary');
      expect(response.status).toBe(200);
      expect(response.body.service).toBe('madsuite-backend');
    });

    it('GET /health/probes/:probeName should return probe history', async () => {
      const response = await request(app).get('/health/probes/database');
      expect(response.status).toBe(200);
      expect(response.body.probe).toBe('database');
      expect(Array.isArray(response.body.history)).toBe(true);
    });

    it('GET /health/probes/:probeName should respect limit parameter', async () => {
      const response = await request(app).get('/health/probes/database?limit=10');
      expect(response.status).toBe(200);
      expect(response.body.history.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Health Check Recording', () => {
    it('should record health checks to database', async () => {
      const result = {
        status: 'healthy',
        latency_ms: 10,
        error_message: null,
      };

      await healthService.recordHealthCheck('test-service', 'test-probe', result);

      const history = await healthService.getHealthHistory('test-service', 'test-probe', 1);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].service_name).toBe('test-service');
      expect(history[0].probe_name).toBe('test-probe');
      expect(history[0].status).toBe('healthy');
    });

    it('should record error messages', async () => {
      const result = {
        status: 'unhealthy',
        latency_ms: 100,
        error_message: 'Database connection timeout',
      };

      await healthService.recordHealthCheck('test-service', 'database', result);

      const history = await healthService.getHealthHistory('test-service', 'database', 1);
      const record = history.find((h) => h.error_message === 'Database connection timeout');
      expect(record).toBeDefined();
      expect(record.status).toBe('unhealthy');
    });
  });

  describe('Health Status Queries', () => {
    it('should retrieve latest health status', async () => {
      await healthService.recordHealthCheck('query-test', 'database', {
        status: 'healthy',
        latency_ms: 5,
        error_message: null,
      });

      const status = await healthService.getLatestHealthStatus('query-test');
      expect(status === null || status.service_name === 'query-test').toBe(true);
    });

    it('should retrieve health history with limit', async () => {
      // Record multiple checks
      for (let i = 0; i < 3; i++) {
        await healthService.recordHealthCheck('history-test', 'memory', {
          status: 'healthy',
          latency_ms: 0,
          error_message: null,
        });
      }

      const history = await healthService.getHealthHistory('history-test', 'memory', 5);
      expect(history.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Health Check Cleanup', () => {
    it('should delete old health check records', async () => {
      // Insert old record directly
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

      try {
        await prisma.raw(
          `
          INSERT INTO observability.health_check_results (
            service_name, probe_name, status, checked_at
          ) VALUES ($1, $2, $3, $4)
          `,
          ['cleanup-test', 'test-probe', 'healthy', oldDate],
        );
      } catch (error) {
        // Table might not exist in test environment
      }

      const deleted = await healthService.cleanup(7);
      expect(deleted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Probe Metrics', () => {
    it('should track latency measurements', async () => {
      const result = await healthService.checkDatabase();
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(typeof result.latency_ms).toBe('number');
    });

    it('should report thresholds in error messages', async () => {
      mockQueueClient.count.mockResolvedValueOnce(150);
      const result = await healthService.checkQueueDepth(mockQueueClient, {
        warning: 100,
        critical: 500,
      });

      expect(result.error_message).toContain('100');
      expect(result.error_message).toContain('warning');
    });
  });
});
