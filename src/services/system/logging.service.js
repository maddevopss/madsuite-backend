const prisma = require('../../../db');

class LoggingService {
  constructor() {
    this.redactionPatterns = [
      { pattern: /password["\s:=]+([^\s",}]+)/gi, replacement: 'password***' },
      { pattern: /bearer\s+([^\s]+)/gi, replacement: 'bearer ***' },
      { pattern: /token["\s:=]+([^\s",}]+)/gi, replacement: 'token***' },
      { pattern: /authorization["\s:=]+([^\s",}]+)/gi, replacement: 'authorization***' },
      { pattern: /card[_]?number["\s:=]+([0-9\s-]+)/gi, replacement: 'card_number***' },
      { pattern: /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, replacement: 'card_number***' },
      { pattern: /cvv["\s:=]+([0-9]+)/gi, replacement: 'cvv***' },
      { pattern: /ssn["\s:=]+([0-9\s-]+)/gi, replacement: 'ssn***' },
      { pattern: /api[_]?key["\s:=]+([^\s",}]+)/gi, replacement: 'api_key***' },
      { pattern: /secret["\s:=]+([^\s",}]+)/gi, replacement: 'secret***' },
    ];
  }

  redact(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    this.redactionPatterns.forEach(({ pattern, replacement }) => {
      result = result.replace(pattern, replacement);
    });
    return result;
  }

  redactObject(obj) {
    if (!obj) return obj;
    if (typeof obj !== 'object') return this.redact(String(obj));

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    const redacted = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact sensitive keys regardless of value
      if (
        /password|token|secret|api_key|ssn|card|cvv|auth/i.test(key)
      ) {
        redacted[key] = '***';
      } else if (typeof value === 'string') {
        redacted[key] = this.redact(value);
      } else if (typeof value === 'object') {
        redacted[key] = this.redactObject(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  async recordLog(logData) {
    const {
      organisation_id,
      level = 'INFO',
      service,
      logger_name,
      message,
      trace_id,
      context,
      stack_trace,
    } = logData;

    // Validate
    if (!organisation_id || !service || !message) {
      throw new Error('Missing required log fields: organisation_id, service, message');
    }

    if (!['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }

    try {
      // Redact sensitive data from message, context, and stack trace
      const redactedMessage = this.redact(message);
      const redactedContext = this.redactObject(context || {});
      const redactedStackTrace = this.redact(stack_trace);

      const log = await prisma.query(
        `
        INSERT INTO observability.log_events (
          organisation_id,
          timestamp,
          level,
          service,
          logger_name,
          message,
          trace_id,
          context,
          stack_trace
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, trace_id, level, created_at
        `,
        [
          organisation_id,
          new Date(),
          level,
          service,
          logger_name || 'default',
          redactedMessage,
          trace_id || null,
          JSON.stringify(redactedContext),
          redactedStackTrace || null,
        ],
      );

      return log.rows[0];
    } catch (error) {
      console.error('Logging service error:', error.message);
      return null;
    }
  }

  async getLogsByOrganisation(organisationId, options = {}) {
    const {
      limit = 100,
      offset = 0,
      level,
      service,
      startTime,
      endTime,
      traceId,
    } = options;

    let query = `
      SELECT id, organisation_id, timestamp, level, service, logger_name, message,
             trace_id, context, stack_trace
      FROM observability.log_events
      WHERE organisation_id = $1
    `;

    const params = [organisationId];
    let paramIndex = 2;

    if (level) {
      query += ` AND level = $${paramIndex}`;
      params.push(level);
      paramIndex += 1;
    }

    if (service) {
      query += ` AND service = $${paramIndex}`;
      params.push(service);
      paramIndex += 1;
    }

    if (startTime) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(startTime);
      paramIndex += 1;
    }

    if (endTime) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(endTime);
      paramIndex += 1;
    }

    if (traceId) {
      query += ` AND trace_id = $${paramIndex}`;
      params.push(traceId);
      paramIndex += 1;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const logs = await prisma.query(query, params);
      return logs.rows.map((log) => ({
        ...log,
        context: log.context || {},
      }));
    } catch (error) {
      console.error('Failed to fetch logs:', error.message);
      return [];
    }
  }

  async searchLogs(organisationId, searchQuery, options = {}) {
    const { limit = 50, offset = 0, level, service } = options;

    let query = `
      SELECT id, timestamp, level, service, logger_name, message,
             trace_id, context,
             ts_rank(to_tsvector('english', message), plainto_tsquery('english', $2)) as rank
      FROM observability.log_events
      WHERE organisation_id = $1
        AND to_tsvector('english', message) @@ plainto_tsquery('english', $2)
    `;

    const params = [organisationId, searchQuery];
    let paramIndex = 3;

    if (level) {
      query += ` AND level = $${paramIndex}`;
      params.push(level);
      paramIndex += 1;
    }

    if (service) {
      query += ` AND service = $${paramIndex}`;
      params.push(service);
      paramIndex += 1;
    }

    query += ` ORDER BY rank DESC, timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const logs = await prisma.query(query, params);
      return logs.rows.map((log) => ({
        ...log,
        context: log.context || {},
      }));
    } catch (error) {
      console.error('Failed to search logs:', error.message);
      return [];
    }
  }

  async getLogStats(organisationId, options = {}) {
    const { startTime = new Date(Date.now() - 3600000), endTime = new Date() } = options;

    try {
      const stats = await prisma.query(
        `
        SELECT
          level,
          COUNT(*)::int as count,
          service,
          COUNT(CASE WHEN stack_trace IS NOT NULL THEN 1 END)::int as error_traces
        FROM observability.log_events
        WHERE organisation_id = $1
          AND timestamp >= $2
          AND timestamp < $3
        GROUP BY level, service
        ORDER BY level DESC, count DESC
        `,
        [organisationId, startTime, endTime],
      );

      return stats.rows;
    } catch (error) {
      console.error('Failed to fetch log stats:', error.message);
      return [];
    }
  }

  async getLogsForTrace(organisationId, traceId) {
    try {
      const logs = await prisma.query(
        `
        SELECT id, timestamp, level, service, logger_name, message, trace_id, context
        FROM observability.log_events
        WHERE organisation_id = $1 AND trace_id = $2
        ORDER BY timestamp ASC
        `,
        [organisationId, traceId],
      );

      return logs.rows.map((log) => ({
        ...log,
        context: log.context || {},
      }));
    } catch (error) {
      console.error('Failed to fetch trace logs:', error.message);
      return [];
    }
  }

  async cleanup(retentionDays = 7) {
    // Delete logs older than retention period
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const result = await prisma.query(
        `
        DELETE FROM observability.log_events
        WHERE created_at < $1
        `,
        [cutoffDate],
      );
      return result.rowCount || 0;
    } catch (error) {
      console.error('Failed to cleanup logs:', error.message);
      return 0;
    }
  }
}

module.exports = new LoggingService();
