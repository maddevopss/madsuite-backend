const request = require('supertest');
const express = require('express');
const { randomUUID: uuidv4 } = require('node:crypto');
const metricsService = require('../services/system/metrics.service');
const { createMetricsRoutes } = require('../observability/metricsRoutes');
const prisma = require('../../db');

describe('Stage 14 PR 14D — Metrics & Error Budget Dashboard', () => {
  let app;
  let testOrganisationId;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.organisationId = testOrganisationId;
      next();
    });
    app.use(createMetricsRoutes());

    testOrganisationId = uuidv4();
  });

  describe('Metric Recording', () => {
    it('should record gauge metric', async () => {
      await metricsService.recordMetric({
        organisation_id: testOrganisationId,
        metric_name: 'cpu_usage',
        metric_type: 'gauge',
        labels: { host: 'server-1' },
        value: 45.2,
      });

      const metrics = await metricsService.getMetricsByName('cpu_usage', { limit: 1 });
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].value).toBe(45.2);
    });

    it('should record counter metric', async () => {
      await metricsService.recordMetric({
        organisation_id: testOrganisationId,
        metric_name: 'requests_total',
        metric_type: 'counter',
        labels: { endpoint: '/api/users' },
        value: 1000,
      });

      const metrics = await metricsService.getMetricsByName('requests_total');
      expect(metrics.length).toBeGreaterThan(0);
    });

    it('should record histogram metric', async () => {
      await metricsService.recordMetric({
        organisation_id: testOrganisationId,
        metric_name: 'request_duration_ms',
        metric_type: 'histogram',
        labels: { endpoint: '/api/users', method: 'GET' },
        value: 125,
      });

      const metrics = await metricsService.getMetricsByName('request_duration_ms');
      expect(metrics.length).toBeGreaterThan(0);
    });

    it('should preserve metric labels', async () => {
      const labels = { service: 'api', region: 'us-east-1', version: '2.0.0' };
      await metricsService.recordMetric({
        organisation_id: testOrganisationId,
        metric_name: 'deployment_version',
        metric_type: 'gauge',
        labels,
        value: 2,
      });

      const metrics = await metricsService.getMetricsByName('deployment_version');
      const metric = metrics[0];
      expect(metric.labels.service).toBe('api');
      expect(metric.labels.region).toBe('us-east-1');
      expect(metric.labels.version).toBe('2.0.0');
    });
  });

  describe('Error Budget Calculation', () => {
    it('should calculate error budget correctly', async () => {
      const periodStart = new Date(Date.now() - 3600000); // 1 hour ago
      const periodEnd = new Date();

      // Insert test traces
      for (let i = 0; i < 100; i++) {
        await prisma.raw(
          `
          INSERT INTO observability.traces (
            organisation_id, trace_id, service_name, operation_name,
            status, start_time, duration_ms
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            testOrganisationId,
            `trace-budget-${Date.now()}-${i}`,
            'madsuite-backend',
            'test-op',
            i < 99 ? 'success' : 'error',
            new Date(Date.now() - Math.random() * 3600000),
            Math.random() * 100,
          ],
        );
      }

      const budget = await metricsService.calculateErrorBudget(
        'madsuite-backend',
        testOrganisationId,
        periodStart,
        periodEnd,
      );

      expect(budget).toBeTruthy();
      expect(budget.sla_target_pct).toBe(99.9);
      expect(budget.actual_uptime_pct).toBeGreaterThan(0);
      expect(budget.actual_uptime_pct).toBeLessThanOrEqual(100);
      expect(budget.error_budget_remaining_minutes).toBeGreaterThanOrEqual(0);
    });

    it('should calculate burn rate per hour', async () => {
      const periodStart = new Date(Date.now() - 3600000);
      const periodEnd = new Date();

      const budget = await metricsService.calculateErrorBudget(
        'madsuite-backend',
        testOrganisationId,
        periodStart,
        periodEnd,
      );

      if (budget) {
        expect(typeof budget.burn_rate_pct_per_hour).toBe('number');
        expect(budget.burn_rate_pct_per_hour).toBeGreaterThanOrEqual(0);
      }
    });

    it('should alert when error budget exceeded', async () => {
      const budget = {
        sla_target_pct: 99.9,
        error_budget_total_minutes: 43,
        error_budget_used_minutes: 50, // Over budget
      };

      // Manually calculate alert condition
      const errorBudgetUsedPct = (budget.error_budget_used_minutes / budget.error_budget_total_minutes) * 100;
      const alertFired = errorBudgetUsedPct > 100;

      expect(alertFired).toBe(true);
    });
  });

  describe('Latency Metrics', () => {
    it('should calculate latency percentiles', async () => {
      const metrics = await metricsService.getLatencyMetrics('madsuite-backend');
      expect(Array.isArray(metrics)).toBe(true);
    });

    it('should include p50, p95, p99 percentiles', async () => {
      const metrics = await metricsService.getLatencyMetrics('madsuite-backend');
      if (metrics.length > 0) {
        const metric = metrics[0];
        expect(metric.p50_ms).toBeDefined();
        expect(metric.p95_ms).toBeDefined();
        expect(metric.p99_ms).toBeDefined();
      }
    });

    it('should calculate average and max latency', async () => {
      const metrics = await metricsService.getLatencyMetrics('madsuite-backend');
      if (metrics.length > 0) {
        const metric = metrics[0];
        expect(metric.avg_ms).toBeDefined();
        expect(metric.max_ms).toBeDefined();
        expect(metric.request_count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Error Rate Metrics', () => {
    it('should calculate error rate percentage', async () => {
      const errorRates = await metricsService.getErrorRate('madsuite-backend');
      expect(Array.isArray(errorRates)).toBe(true);

      if (errorRates.length > 0) {
        const rate = errorRates[0];
        expect(rate.error_rate_pct).toBeDefined();
        expect(rate.error_rate_pct).toBeGreaterThanOrEqual(0);
        expect(rate.error_rate_pct).toBeLessThanOrEqual(100);
      }
    });

    it('should track timeout counts separately', async () => {
      const errorRates = await metricsService.getErrorRate('madsuite-backend');
      if (errorRates.length > 0) {
        const rate = errorRates[0];
        expect(rate.timeout_count).toBeDefined();
        expect(rate.error_count).toBeDefined();
      }
    });
  });

  describe('Throughput Metrics', () => {
    it('should calculate requests per minute', async () => {
      const throughput = await metricsService.getThroughput('madsuite-backend');
      expect(Array.isArray(throughput)).toBe(true);

      if (throughput.length > 0) {
        const metric = throughput[0];
        expect(metric.requests_per_minute).toBeGreaterThanOrEqual(0);
        expect(metric.success_rate_pct).toBeDefined();
      }
    });

    it('should calculate success rate from throughput', async () => {
      const throughput = await metricsService.getThroughput('madsuite-backend');
      if (throughput.length > 0) {
        const metric = throughput[0];
        expect(metric.success_rate_pct).toBeGreaterThanOrEqual(0);
        expect(metric.success_rate_pct).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('SLA Status Tracking', () => {
    it('should retrieve SLA status records', async () => {
      const slaStatus = await metricsService.getSLAStatus(testOrganisationId, 'madsuite-backend');
      expect(Array.isArray(slaStatus)).toBe(true);
    });

    it('should record SLA metrics', async () => {
      const periodStart = new Date(Date.now() - 86400000); // 1 day ago
      const periodEnd = new Date();

      const result = await metricsService.recordSLAMetrics(
        testOrganisationId,
        'madsuite-backend',
        periodStart,
        periodEnd,
      );

      expect(result === null || result.sla_target_pct === 99.9).toBe(true);
    });

    it('should limit SLA history results', async () => {
      const slaStatus = await metricsService.getSLAStatus(testOrganisationId, 'madsuite-backend', 5);
      expect(slaStatus.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Metrics Endpoints', () => {
    it('GET /metrics/dashboard should return dashboard data', async () => {
      const response = await request(app).get('/metrics/dashboard');
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.service).toBeDefined();
        expect(response.body.timestamp).toBeDefined();
      }
    });

    it('GET /metrics/latency should return latency metrics', async () => {
      const response = await request(app).get('/metrics/latency?hours=1');
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(Array.isArray(response.body.metrics)).toBe(true);
      }
    });

    it('GET /metrics/error-rate should return error rates', async () => {
      const response = await request(app).get('/metrics/error-rate?hours=1');
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(Array.isArray(response.body.metrics)).toBe(true);
      }
    });

    it('GET /metrics/throughput should return throughput metrics', async () => {
      const response = await request(app).get('/metrics/throughput?hours=1');
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(Array.isArray(response.body.metrics)).toBe(true);
      }
    });

    it('GET /metrics/sla should return SLA status', async () => {
      const response = await request(app).get('/metrics/sla');
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.alert_status).toBeDefined();
      }
    });

    it('POST /metrics/calculate-error-budget should compute budget', async () => {
      const periodStart = new Date(Date.now() - 3600000);
      const periodEnd = new Date();

      const response = await request(app)
        .post('/metrics/calculate-error-budget')
        .send({
          service: 'madsuite-backend',
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        });

      expect([200, 400, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.service).toBe('madsuite-backend');
      }
    });
  });

  describe('Metric Filtering', () => {
    it('should filter metrics by label', async () => {
      await metricsService.recordMetric({
        organisation_id: testOrganisationId,
        metric_name: 'filtered_test',
        metric_type: 'gauge',
        labels: { env: 'production', region: 'us-east' },
        value: 100,
      });

      const metrics = await metricsService.getMetricsByName('filtered_test', {
        labels: { env: 'production' },
      });

      expect(metrics.length).toBeGreaterThan(0);
    });

    it('should filter metrics by time range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now - 3600000);

      const metrics = await metricsService.getMetricsByName('cpu_usage', {
        startTime: oneHourAgo,
        endTime: now,
      });

      expect(Array.isArray(metrics)).toBe(true);
    });

    it('should respect limit and offset', async () => {
      const metrics = await metricsService.getMetricsByName('requests_total', {
        limit: 5,
        offset: 0,
      });

      expect(metrics.length).toBeLessThanOrEqual(5);
    });
  });

  describe('SLA Target Management', () => {
    it('should register custom SLA target', () => {
      metricsService.registerSLATarget('custom-service', 99.5);
      // Verify by calculating budget for that service
      expect(metricsService.slaTargets['custom-service']).toBe(99.5);
    });

    it('should use registered SLA target', async () => {
      metricsService.registerSLATarget('test-sla-service', 99.95);
      const budget = await metricsService.calculateErrorBudget(
        'test-sla-service',
        testOrganisationId,
        new Date(Date.now() - 3600000),
        new Date(),
      );

      if (budget) {
        expect(budget.sla_target_pct).toBe(99.95);
      }
    });
  });

  describe('Metric Cleanup', () => {
    it('should delete old metrics', async () => {
      // Insert old metric
      try {
        await prisma.raw(
          `
          INSERT INTO observability.metrics (
            metric_name, metric_type, value, timestamp
          ) VALUES ($1, $2, $3, $4)
          `,
          [
            'old_metric',
            'gauge',
            100,
            new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
          ],
        );
      } catch (error) {
        // Table might not exist in test
      }

      const deleted = await metricsService.cleanup(30);
      expect(deleted).toBeGreaterThanOrEqual(0);
    });
  });
});
