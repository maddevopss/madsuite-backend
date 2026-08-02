const prisma = require('../../db/db');

class TracingService {
  async recordTrace(traceData) {
    const {
      organisation_id,
      trace_id,
      service_name,
      operation_name,
      status,
      start_time,
      duration_ms,
      error_message,
      tags,
      parent_span_id,
    } = traceData;

    // Validate required fields
    if (!organisation_id || !trace_id || !service_name || !operation_name) {
      throw new Error('Missing required trace fields');
    }

    if (!['success', 'error', 'timeout'].includes(status)) {
      throw new Error(`Invalid trace status: ${status}`);
    }

    try {
      const trace = await prisma.raw(
        `
        INSERT INTO observability.traces (
          organisation_id,
          trace_id,
          service_name,
          operation_name,
          status,
          start_time,
          duration_ms,
          error_message,
          tags,
          parent_span_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, trace_id, organisation_id, created_at
        `,
        [
          organisation_id,
          trace_id,
          service_name,
          operation_name,
          status,
          start_time,
          duration_ms,
          error_message,
          JSON.stringify(tags || {}),
          parent_span_id || null,
        ],
      );

      return trace[0];
    } catch (error) {
      // Don't throw - tracing should not break application
      console.error('Tracing service error:', error.message);
      return null;
    }
  }

  async getTracesByOrganisation(organisationId, options = {}) {
    const { limit = 100, offset = 0, status, startTime, endTime } = options;

    let query = `
      SELECT id, trace_id, service_name, operation_name, status,
             duration_ms, start_time, error_message, tags
      FROM observability.traces
      WHERE organisation_id = $1
    `;

    const params = [organisationId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    if (startTime) {
      query += ` AND start_time >= $${paramIndex}`;
      params.push(startTime);
      paramIndex += 1;
    }

    if (endTime) {
      query += ` AND start_time <= $${paramIndex}`;
      params.push(endTime);
      paramIndex += 1;
    }

    query += ` ORDER BY start_time DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const traces = await prisma.raw(query, params);
      return traces;
    } catch (error) {
      console.error('Failed to fetch traces:', error.message);
      return [];
    }
  }

  async getTraceById(traceId) {
    try {
      const trace = await prisma.raw(
        `
        SELECT id, trace_id, organisation_id, service_name, operation_name,
               status, duration_ms, start_time, error_message, tags, created_at
        FROM observability.traces
        WHERE trace_id = $1
        LIMIT 1
        `,
        [traceId],
      );
      return trace[0] || null;
    } catch (error) {
      console.error('Failed to fetch trace:', error.message);
      return null;
    }
  }

  async getTraceMetrics(organisationId, options = {}) {
    const { startTime = new Date(Date.now() - 3600000), endTime = new Date() } = options;

    try {
      const metrics = await prisma.raw(
        `
        SELECT
          service_name,
          COUNT(*) as total_traces,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count,
          COUNT(CASE WHEN status = 'timeout' THEN 1 END) as timeout_count,
          AVG(duration_ms) as avg_duration_ms,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50_duration_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_duration_ms,
          MAX(duration_ms) as max_duration_ms
        FROM observability.traces
        WHERE organisation_id = $1
          AND start_time >= $2
          AND start_time < $3
        GROUP BY service_name
        `,
        [organisationId, startTime, endTime],
      );
      return metrics;
    } catch (error) {
      console.error('Failed to fetch trace metrics:', error.message);
      return [];
    }
  }

  async cleanup(retentionDays = 30) {
    // Delete old traces (configurable retention)
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const result = await prisma.raw(
        `
        DELETE FROM observability.traces
        WHERE created_at < $1
        `,
        [cutoffDate],
      );
      return result.rowCount || 0;
    } catch (error) {
      console.error('Failed to cleanup traces:', error.message);
      return 0;
    }
  }
}

module.exports = new TracingService();
