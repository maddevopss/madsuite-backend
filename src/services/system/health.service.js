const prisma = require('../../../db');
const os = require('os');

class HealthService {
  constructor() {
    this.probes = {};
    this.lastCheck = {};
    this.checkInterval = 30000; // 30 seconds
  }

  registerProbe(name, checkFn) {
    this.probes[name] = checkFn;
  }

  async checkDatabase() {
    const startTime = Date.now();
    try {
      await prisma.query('SELECT 1');
      return {
        status: 'healthy',
        latency_ms: Math.max(1, Date.now() - startTime),
        error_message: null,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency_ms: Date.now() - startTime,
        error_message: error.message,
      };
    }
  }

  async checkRedis(redisClient) {
    if (!redisClient) {
      return {
        status: 'degraded',
        latency_ms: 0,
        error_message: 'Redis client not configured',
      };
    }

    const startTime = Date.now();
    try {
      await redisClient.ping();
      return {
        status: 'healthy',
        latency_ms: Date.now() - startTime,
        error_message: null,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency_ms: Date.now() - startTime,
        error_message: error.message,
      };
    }
  }

  async checkQueueDepth(queueClient, thresholds = { warning: 100, critical: 500 }) {
    if (!queueClient) {
      return {
        status: 'degraded',
        latency_ms: 0,
        error_message: 'Queue client not configured',
      };
    }

    const startTime = Date.now();
    try {
      const depth = await queueClient.count?.() || 0;
      const latency = Date.now() - startTime;

      if (depth > thresholds.critical) {
        return {
          status: 'unhealthy',
          latency_ms: latency,
          error_message: `Queue depth ${depth} exceeds critical threshold ${thresholds.critical}`,
        };
      }

      if (depth > thresholds.warning) {
        return {
          status: 'degraded',
          latency_ms: latency,
          error_message: `Queue depth ${depth} exceeds warning threshold ${thresholds.warning}`,
        };
      }

      return {
        status: 'healthy',
        latency_ms: latency,
        error_message: null,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency_ms: Date.now() - startTime,
        error_message: error.message,
      };
    }
  }

  async checkDiskSpace(thresholds = { warning: 10, critical: 5 }) {
    // thresholds in percentage of free space
    try {
      // Simplified check - in production would use df or similar
      const stats = await require('fs/promises').statfs('/');
      const totalSpace = stats.blocks * stats.bsize;
      const freeSpace = stats.bfree * stats.bsize;
      const percentFree = (freeSpace / totalSpace) * 100;

      if (percentFree < thresholds.critical) {
        return {
          status: 'unhealthy',
          latency_ms: 0,
          error_message: `Disk space critical: ${percentFree.toFixed(2)}% free`,
        };
      }

      if (percentFree < thresholds.warning) {
        return {
          status: 'degraded',
          latency_ms: 0,
          error_message: `Disk space warning: ${percentFree.toFixed(2)}% free`,
        };
      }

      return {
        status: 'healthy',
        latency_ms: 0,
        error_message: null,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency_ms: 0,
        error_message: error.message,
      };
    }
  }

  checkMemory(thresholds = { warning: 80, critical: 95 }) {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedPercent = ((totalMemory - freeMemory) / totalMemory) * 100;

    if (usedPercent > thresholds.critical) {
      return {
        status: 'unhealthy',
        latency_ms: 0,
        error_message: `Memory usage critical: ${usedPercent.toFixed(2)}%`,
      };
    }

    if (usedPercent > thresholds.warning) {
      return {
        status: 'degraded',
        latency_ms: 0,
        error_message: `Memory usage warning: ${usedPercent.toFixed(2)}%`,
      };
    }

    return {
      status: 'healthy',
      latency_ms: 0,
      error_message: null,
    };
  }

  async recordHealthCheck(serviceName, probeName, result) {
    try {
      await prisma.query(
        `
        INSERT INTO observability.health_check_results (
          service_name, probe_name, status, latency_ms, error_message, checked_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          serviceName,
          probeName,
          result.status,
          result.latency_ms || 0,
          result.error_message || null,
          new Date(),
        ],
      );
    } catch (error) {
      console.error('Failed to record health check:', error.message);
    }
  }

  async performHealthChecks(dependencies = {}) {
    const results = {};
    const startTime = Date.now();

    // Run all registered probes
    const checks = [
      ['database', () => this.checkDatabase()],
      ['redis', () => this.checkRedis(dependencies.redis)],
      ['queue', () => this.checkQueueDepth(dependencies.queue)],
      ['disk', () => this.checkDiskSpace()],
      ['memory', () => this.checkMemory()],
    ];

    for (const [probeName, checkFn] of checks) {
      try {
        const result = await checkFn();
        results[probeName] = result;
        // Record to database
        await this.recordHealthCheck('madsuite-backend', probeName, result);
      } catch (error) {
        results[probeName] = {
          status: 'unhealthy',
          latency_ms: Date.now() - startTime,
          error_message: error.message,
        };
      }
    }

    // Determine overall status