const express = require('express');
const metricsService = require('../services/system/metrics.service');

const createMetricsRoutes = () => {
  const router = express.Router();

  // GET /metrics/dashboard - Overall observability dashboard
  router.get('/metrics/dashboard', async (req, res) => {
    const { service = 'madsuite-backend' } = req.query;
    const organisationId = req.organisationId;

    try {
      const latencyMetrics = await metricsService.getLatencyMetrics(service, {
        startTime: new Date(Date.now() - 3600000), // Last hour
        endTime: new Date(),
      });

      const errorRates = await metricsService.getErrorRate(service, {
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(),
      });

      const throughput = await metricsService.getThroughput(service, {
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(),
      });

      const slaStatus = await metricsService.getSLAStatus(organisationId, service, 1);

      res.json({
        service,
        timestamp: new Date().toISOString(),
        latency: latencyMetrics,
        error_rates: errorRates,
        throughput,
        sla_status: slaStatus[0] || null,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /metrics/latency - Latency percentiles
  router.get('/metrics/latency', async (req, res) => {
    const { service = 'madsuite-backend', hours = 1 } = req.query;

    try {
      const startTime = new Date(Date.now() - hours * 3600000);
      const metrics = await metricsService.getLatencyMetrics(service, {
        startTime,
        endTime: new Date(),
      });

      res.json({
        service,
        period_hours: parseInt(hours),
        metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /metrics/error-rate - Error rate over time
  router.get('/metrics/error-rate', async (req, res) => {
    const { service = 'madsuite-backend', hours = 1 } = req.query;

    try {
      const startTime = new Date(Date.now() - hours * 3600000);
      const metrics = await metricsService.getErrorRate(service, {
        startTime,
        endTime: new Date(),
      });

      res.json({
        service,
        period_hours: parseInt(hours),
        metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /metrics/throughput - Requests per minute
  router.get('/metrics/throughput', async (req, res) => {
    const { service = 'madsuite-backend', hours = 1 } = req.query;

    try {
      const startTime = new Date(Date.now() - hours * 3600000);
      const metrics = await metricsService.getThroughput(service, {
        startTime,
        endTime: new Date(),
      });

      res.json({
        service,
        period_hours: parseInt(hours),
        metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /metrics/sla - SLA status and error budget
  router.get('/metrics/sla', async (req, res) => {
    const { service = 'madsuite-backend', limit = 10 } = req.query;
    const organisationId = req.organisationId;

    try {
      const slaRecords = await metricsService.getSLAStatus(organisationId, service, parseInt(limit));

      // Calculate latest status
      const latest = slaRecords[0];
      const alert = latest?.alert_fired ? 'ALERT' : 'OK';

      res.json({
        service,
        alert_status: alert,
        latest,
        history: slaRecords,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /metrics/calculate-error-budget - Compute error budget for period
  router.post('/metrics/calculate-error-budget', async (req, res) => {
    const { service, period_start, period_end } = req.body;
    const organisationId = req.organisationId;

    if (!service || !period_start || !period_end) {
      return res.status(400).json({
        error: 'Required fields: service, period_start, period_end',
      });
    }

    try {
      const budget = await metricsService.calculateErrorBudget(
        service,
        organisationId,
        new Date(period_start),
        new Date(period_end),
      );

      if (!budget) {
        return res.status(400).json({ error: 'Failed to calculate error budget' });
      }

      res.json({
        service,
        period_start,
        period_end,
        ...budget,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

module.exports = {
  createMetricsRoutes,
};
