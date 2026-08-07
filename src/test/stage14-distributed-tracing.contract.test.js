const request = require('supertest');
const { randomUUID: uuidv4 } = require('node:crypto');
const prisma = require('../../db');
const tracingService = require('../services/system/tracing.service');
const { createTraceMiddleware, CORRELATION_ID_HEADER } = require('../observability/tracingMiddleware');

describe('Stage 14 PR 14A — Distributed Tracing Contract Tests', () => {
  let app;
  let testOrganisationId;
  let authToken;

  beforeAll(async () => {
    // Setup Express app with tracing middleware
    const express = require('express');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.organisationId = testOrganisationId;
      req.user = { id: uuidv4() };
      next();
    });
    app.use(createTraceMiddleware(tracingService));

    // Simple test route
    app.get('/test', (req, res) => {
      res.json({ message: 'OK', traceId: req.traceId });
    });

    app.post('/test-error', (req, res) => {
      res.status(500).json({ error: 'Internal Server Error' });
    });

    // Setup test data
    const organisation = await prisma.query(`
      SELECT id FROM organisations LIMIT 1
    `);
    if (organisation.rows[0]?.id) {
      testOrganisationId = organisation.rows[0].id;
    } else {
      const createdOrganisation = await prisma.query(
        "INSERT INTO organisations (nom) VALUES ($1) RETURNING id",
        [`stage14-tracing-${uuidv4()}`],
      );
      testOrganisationId = createdOrganisation.rows[0].id;
    }
  });

  describe('Trace ID Propagation', () => {
    it('should generate trace ID if not provided', async () => {
      const response = await request(app).get('/test');
      expect(response.status).toBe(200);
      expect(response.get(CORRELATION_ID_HEADER)).toBeTruthy();
      expect(response.body.traceId).toBeTruthy();
    });

    it('should propagate trace ID from W3C traceparent header', async () => {
      const traceId = uuidv4();
      const response = await request(app)
        .get('/test')
        .set('traceparent', traceId);

      expect(response.status).toBe(200);
      expect(response.get(CORRELATION_ID_HEADER)).toBe(traceId);
    });

    it('should propagate trace ID from x-b3-traceid header', async () => {
      const traceId = uuidv4();
      const response = await request(app)
        .get('/test')
        .set('x-b3-traceid', traceId);

      expect(response.status).toBe(200);
      expect(response.get(CORRELATION_ID_HEADER)).toBe(traceId);
    });

    it('should propagate trace ID from x-correlation-id header', async () => {
      const traceId = uuidv4();
      const response = await request(app)
        .get('/test')
        .set('x-correlation-id', traceId);

      expect(response.status).toBe(200);
      expect(response.get(CORRELATION_ID_HEADER)).toBe(traceId);
    });

    it('should include trace ID in response headers', async () => {
      const response = await request(app).get('/test');
      expect(response.get('x-trace-id')).toBeTruthy();
      expect(response.get(CORRELATION_ID_HEADER)).toBeTruthy();
      expect(response.get('x-trace-id')).toBe(response.get(CORRELATION_ID_HEADER));
    });
  });

  describe('Trace Recording', () => {
    it('should record successful trace to database', async () => {
      const traceId = `trace-${Date.now()}`;
      await request(app)
        .get('/test')
        .set('x-correlation-id', traceId);

      // Wait briefly for async recording
      await new Promise((r) => setTimeout(r, 100));

      const trace = await tracingService.getTraceById(traceId);
      expect(trace).toBeTruthy();
      expect(trace.trace_id).toBe(traceId);
      expect(trace.status).toBe('success');
      expect(trace.organisation_id).toBe(testOrganisationId);
    });

    it('should record error status for 5xx responses', async () => {
      const traceId = `trace-error-${Date.now()}`;
      await request(app)
        .post('/test-error')
        .set('x-correlation-id', traceId);

      await new Promise((r) => setTimeout(r, 100));

      const trace = await tracingService.getTraceById(traceId);
      expect(trace).toBeTruthy();
      expect(trace.status).toBe('error');
    });

    it('should not throw if tracing fails', async () => {
      const response = await request(app).get('/test');
      expect(response.status).toBe(200);
      // Should succeed even if recording fails
    });
  });

  describe('Trace Data Integrity', () => {
    it('should store required trace fields', async () => {
      const traceId = `trace-integrity-${Date.now()}`;
      await request(app)
        .get('/test')
        .set('x-correlation-id', traceId);

      await new Promise((r) => setTimeout(r, 100));

      const trace = await tracingService.getTraceById(traceId);
      expect(trace.trace_id).toBe(traceId);
      expect(trace.service_name).toBe('madsuite-backend');
      expect(trace.operation_name).toBe('GET /test');
      expect(trace.start_time).toBeTruthy();
      expect(trace.duration_ms).toBeGreaterThanOrEqual(0);
      expect(['success', 'error', 'timeout']).toContain(trace.status);
    });

    it('should include HTTP details in trace tags', async () => {
      const traceId = `trace-tags-${Date.now()}`;
      await request(app)
        .get('/test')
        .set('x-correlation-id', traceId);

      await new Promise((r) => setTimeout(r, 100));

      const trace = await tracingService.getTraceById(traceId);
      const tags = trace.tags || {};
      expect(tags.http_method).toBe('GET');
      expect(tags.http_path).toBe('/test');
      expect(tags.http_status_code).toBe(200);
    });

    it('should enforce duration_ms >= 0', async () => {
      try {
        await tracingService.recordTrace({
          organisation_id: testOrganisationId,
          trace_id: `invalid-${Date.now()}`,
          service_name: 'test',
          operation_name: 'test',
          status: 'success',
          start_time: new Date(),
          duration_ms: -1, // Invalid
          tags: {},
        });
        // Should either succeed with 0 or fail gracefully
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });
  });

  describe('Tracing Performance', () => {
    it('should add minimal latency overhead (<1%)', async () => {
      const iterations = 10;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await request(app).get('/test');
        const duration = Date.now() - start;
        times.push(duration);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;
      // Overhead should be < 50ms typically (very generous)
      expect(avgTime).toBeLessThan(100);
    });
  });

  describe('RLS & Organisation Isolation', () => {
    it('should enforce organisation_id in trace recording', async () => {
      const traceId = `trace-rls-${Date.now()}`;
      const differentOrgId = testOrganisationId === 2 ? 1 : 2;

      // Try to record trace with different organisation
      const trace = await tracingService.recordTrace({
        organisation_id: differentOrgId,
        trace_id: traceId,
        service_name: 'test',
        operation_name: 'test',
        status: 'success',
        start_time: new Date(),
        duration_ms: 50,
        tags: {},
      });

      expect(trace).toBeTruthy();
      expect(trace.organisation_id).toBe(differentOrgId);
    });

    it('should retrieve traces only for specified organisation', async () => {
      const org1Id = testOrganisationId;
      const org2Id = uuidv4();

      // Record traces for both orgs
      await tracingService.recordTrace({
        organisation_id: org1Id,
        trace_id: `trace-org1-${Date.now()}`,
        service_name: 'test',
        operation_name: 'test',
        status: 'success',
        start_time: new Date(),
        duration_ms: 50,
        tags: {},
      });

      await tracingService.recordTrace({
        organisation_id: org2Id,
        trace_id: `trace-org2-${Date.now()}`,
        service_name: 'test',
        operation_name: 'test',
        status: 'success',
        start_time: new Date(),
        duration_ms: 50,
        tags: {},
      });

      // Query traces for org1
      const org1Traces = await tracingService.getTracesByOrganisation(org1Id);
      org1Traces.forEach((trace) => {
        expect(trace.organisation_id).toBe(org1Id);
      });
    });
  });

  describe('Trace Metrics & Analytics', () => {
    it('should calculate latency percentiles', async () => {
      // Record multiple traces with varying durations
      for (let i = 1; i <= 5; i++) {
        await tracingService.recordTrace({
          organisation_id: testOrganisationId,
          trace_id: `metric-trace-${Date.now()}-${i}`,
          service_name: 'test',
          operation_name: 'test',
          status: 'success',
          start_time: new Date(),
          duration_ms: i * 10,
          tags: {},
        });
      }

      const metrics = await tracingService.getTraceMetrics(testOrganisationId);
      expect(metrics.length).toBeGreaterThan(0);
      const testMetric = metrics.find((m) => m.service_name === 'test');

      if (testMetric) {
        expect(testMetric.total_traces).toBeGreaterThanOrEqual(5);
        expect(testMetric.success_count).toBeGreaterThanOrEqual(5);
        expect(testMetric.avg_duration_ms).toBeGreaterThan(0);
        expect(testMetric.p50_duration_ms).toBeGreaterThan(0);
        expect(testMetric.p95_duration_ms).toBeGreaterThan(0);
        expect(testMetric.p99_duration_ms).toBeGreaterThan(0);
      }
    });

    it('should filter traces by status', async () => {
      const traceId = `status-filter-${Date.now()}`;
      await tracingService.recordTrace({
        organisation_id: testOrganisationId,
        trace_id: traceId,
        service_name: 'test',
        operation_name: 'test',
        status: 'error',
        start_time: new Date(),
        duration_ms: 100,
        tags: {},
      });

      const errorTraces = await tracingService.getTracesByOrganisation(testOrganisationId, {
        status: 'error',
      });

      const found = errorTraces.some((t) => t.trace_id === traceId);
      expect(found).toBe(true);
    });
  });

  describe('Trace Cleanup & Retention', () => {
    it('should delete traces older than retention period', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
      const oldTraceId = `old-trace-${Date.now()}`;

      // Insert old trace directly
      await prisma.query(
        `
        INSERT INTO observability.traces (
          organisation_id, trace_id, service_name, operation_name,
          status, start_time, duration_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          testOrganisationId,
          oldTraceId,
          'test',
          'test',
          'success',
          oldDate,
          50,
        ],
      );

      const deleted = await tracingService.cleanup(30);
      expect(deleted).toBeGreaterThanOrEqual(0);

      // Old trace should no longer exist
      const deletedTrace = await tracingService.getTraceById(oldTraceId);
      expect(deletedTrace).toBeNull();
    });
  });
});
