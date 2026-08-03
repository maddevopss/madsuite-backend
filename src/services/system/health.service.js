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
      await prisma.raw('SELECT 1');
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
      await prisma.raw(
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
    const overallStatus = this.computeOverallStatus(results);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      probes: results,
      checked_at: new Date(),
    };
  }

  computeOverallStatus(probeResults) {
    const statuses = Object.values(probeResults).map((r) => r.status);

    if (statuses.some((s) => s === 'unhealthy')) {
      return 'unhealthy';
    }
    if (statuses.some((s) => s === 'degraded')) {
      return 'degraded';
    }
    return 'healthy';
  }

  async getLatestHealthStatus(serviceName) {
    try {
      const result = await prisma.raw(
        `
        SELECT service_name, overall_status, latest_latency_ms,
               last_checked_at, healthy_probes, degraded_probes, unhealthy_probes
        FROM observability.health_summary
        WHERE service_name = $1
        `,
        [serviceName],
      );

      return result[0] || null;
    } catch (error) {
      console.error('Failed to fetch health status:', error.message);
      return null;
    }
  }

  async getHealthHistory(serviceName, probeName, limit = 100) {
    try {
      const result = await prisma.raw(
        `
        SELECT service_name, probe_name, status, latency_ms, error_message, checked_at
        FROM observability.health_check_results
        WHERE service_name = $1 AND probe_name = $2
        ORDER BY checked_at DESC
        LIMIT $3
        `,
        [serviceName, probeName, limit],
      );

      return result;
    } catch (error) {
      console.error('Failed to fetch health history:', error.message);
      return [];
    }
  }

  async cleanup(retentionDays = 7) {
    // Delete old health check records
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const result = await prisma.raw(
        `
        DELETE FROM observability.health_check_results
        WHERE created_at < $1
        `,
        [cutoffDate],
      );

      return result.rowCount || 0;
    } catch (error) {
      console.error('Failed to cleanup health checks:', error.message);
      return 0;
    }
  }
}

module.exports = new HealthService();
