const express = require('express');
const healthService = require('../services/system/health.service');

const createHealthRoutes = (dependencies = {}) => {
  const router = express.Router();

  // GET /health - Full health check (readiness probe)
  // Used by load balancers and orchestrators to determine if service accepts traffic
  router.get('/health', async (req, res) => {
    try {
      const health = await healthService.performHealthChecks(dependencies);

      // Return appropriate HTTP status
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 503;

      res.status(statusCode).json({
        status: health.status,
        timestamp: health.timestamp,
        uptime_seconds: health.uptime_seconds,
        probes: health.probes,
      });
    } catch (error) {
      console.error('Health check error:', error);
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // GET /health/live - Liveness probe
  // Checks if the process is still running (minimal checks)
  router.get('/health/live', (req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  // GET /health/ready - Readiness probe
  // Checks if the service is ready to accept traffic
  router.get('/health/ready', async (req, res) => {
    try {
      const health = await healthService.performHealthChecks(dependencies);

      if (health.status === 'healthy') {
        res.status(200).json({
          status: 'ready',
          timestamp: health.timestamp,
        });
      } else {
        res.status(503).json({
          status: 'not_ready',
          reason: health.status === 'degraded' ? 'Some dependencies degraded' : 'Critical dependency failed',
          probes: health.probes,
          timestamp: health.timestamp,
        });
      }
    } catch (error) {
      res.status(503).json({
        status: 'not_ready',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // GET /health/probes/:probeName - Individual probe history
  router.get('/health/probes/:probeName', async (req, res) => {
    const { probeName } = req.params;
    const { limit = 50 } = req.query;

    try {
      const history = await healthService.getHealthHistory('madsuite-backend', probeName, parseInt(limit));
      res.json({
        probe: probeName,
        history,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /health/summary - Overall health summary
  router.get('/health/summary', async (req, res) => {
    try {
      const summary = await healthService.getLatestHealthStatus('madsuite-backend');
      res.json({
        service: 'madsuite-backend',
        summary: summary || { status: 'unknown' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

module.exports = {
  createHealthRoutes,
};
