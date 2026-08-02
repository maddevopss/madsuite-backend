const prisma = require('../../db/db');

class MetricsService {
  constructor() {
    this.slaTargets = {
      'madsuite-backend': 99.9, // 99.9% uptime (43 minutes/month error budget)
    };
  }

  registerSLATarget(serviceName, targetPercent) {
    this.slaTargets[serviceName] = targetPercent;
  }

  async recordMetric(metricData) {
    const {
      organisation_id,
      metric_name,
      metric_type,
      labels = {},
      value,
    } = metricData;

    if (!metric_name || !['gauge', 'counter', 'histogram', 'summary'].includes(metric_type)) {
      throw new Error('Invalid metric data');
    }

    try {
      await prisma.raw(
        `
        INSERT INTO observability.metrics (
          organisation_id, metric_name, metric_type, labels, value, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          organisation_id,
          metric_name,
          metric_type,
          JSON.stringify(labels),
          value,
          new Date(),
        ],
      );
    } catch (error) {
      console.error('Failed to record metric:', error.message);
    }
  }

  async calculateErrorBudget(serviceName, organisationId, periodStart, periodEnd) {
    const slaTarget = this.slaTargets[serviceName] || 99.9;

    try {
      // Get uptime from traces
      const traceStats = await prisma.raw(
        `
        SELECT
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE status = 'success') as successful_requests,
          COUNT(*) FILTER (WHERE status = 'error') as error_requests,
          COUNT(*) FILTER (WHERE status = 'timeout') as timeout_requests
        FROM observability.traces
        WHERE service_name = $1
          AND start_time >= $2
          AND start_time < $3
        `,
        [serviceName, periodStart, periodEnd],
      );

      const stats = traceStats[0] || {
        total_requests: 0,
        successful_requests: 0,
        error_requests: 0,
        timeout_requests: 0,
      };

      // Calculate uptime percentage
      const actualUptimePct = stats.total_requests > 0
        ? (stats.successful_requests / stats.total_requests) * 100
        : 100;

      // Calculate error budget
      const periodMinutes = (periodEnd - periodStart) / (1000 * 60);
      const errorBudgetTotalMinutes = (periodMinutes * (100 - slaTarget)) / 100;
      const errorBudgetUsedMinutes = (periodMinutes * (100 - actualUptimePct)) / 100;
      const errorBudgetRemainingMinutes = Math.max(0, errorBudgetTotalMinutes - errorBudgetUsedMinutes);
      const errorBudgetUsedPct = errorBudgetTotalMinutes > 0
        ? (errorBudgetUsedMinutes / errorBudgetTotalMinutes) * 100
        : 0;

      // Calculate burn rate (% per hour)
      const hoursSinceStart = (new Date() - periodStart) / (1000 * 60 * 60);
      const burnRatePercentPerHour = hoursSinceStart > 0
        ? (errorBudgetUsedPct / hoursSinceStart)
        : 0;

      // Check if alert should fire (>100% error budget used)
      const alertFired = errorBudgetUsedPct > 100;

      return {
        service_name: serviceName,
        sla_target_pct: slaTarget,
        actual_uptime_pct: actualUptimePct,
        error_budget_total_minutes: errorBudgetTotalMinutes,
        error_budget_used_minutes: errorBudgetUsedMinutes,
        error_budget_remaining_minutes: errorBudgetRemainingMinutes,
        error_budget_used_pct: errorBudgetUsedPct,
        burn_rate_pct_per_hour: burnRatePercentPerHour,
        alert_fired: alertFired,
        trace_stats: stats,
      };
    } catch (error) {
      console.error('Failed to calculate error budget:', error.message);
      return null;
    }
  }

  async recordSLAMetrics(organisationId, serviceName, periodStart, periodEnd) {
    const budget = await this.calculateErrorBudget(serviceName, organisationId, periodStart, periodEnd);

    if (!budget) return null;

    try {
      await prisma.raw(
        `
        INSERT INTO observability.sla_burn_rate (
          organisation_id, service_name, period_start, period_end,
          sla_target_pct, actual_uptime_pct, error_budget_total_minutes,
          error_budget_used_minutes, error_budget_remaining_minutes,
          error_budget_used_pct, burn_rate_pct_per_hour, alert_fired
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
        `,
        [
          organisationId,
          serviceName,
          periodStart,
          periodEnd,
          budget.sla_target_pct,
          budget.actual_uptime_pct,
          budget.error_budget_total_minutes,
          budget.error_budget_used_minutes,
          budget.error_budget_remaining_minutes,
          budget.error_budget_used_pct,
          budget.burn_rate_pct_per_hour,
          budget.alert_fired,
        ],
      );

      return budget;
    } catch (error) {
      console.error('Failed to record SLA metrics:', error.message);
      return null;
    }
  }

  async getLatencyMetrics(serviceName, options = {}) {
    const { startTime = new Date(Date.now() - 3600000), endTime = new Date() } = options;

    try {
      const metrics = await prisma.raw(
        `
        SELECT
          service_name,
          date_trunc('minute', start_time) as minute,
          COUNT(*) as request_count,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_ms,
          MAX(duration_ms) as max_ms,
          AVG(duration_ms)::NUMERIC(10,2) as avg_ms
        FROM observability.traces
        WHERE service_name = $1
          AND start_time >= $2
          AND start_time < $3
        GROUP BY service_name, date_trunc('minute', start_time)
        ORDER BY minute DESC
        `,
        [serviceName, startTime, endTime],
      );

      return metrics;
    } catch (error) {
      console.error('Failed to fetch latency metrics:', error.message);
      return [];
    }
  }

  async getErrorRate(serviceName, options = {}) {
    const { startTime = new Date(Date.now() - 3600000), endTime = new Date() } = options;

    try {
      const metrics = await prisma.raw(
        `
        SELECT
          service_name,
          date_trunc('minute', start_time) as minute,
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE status = 'error') as error_count,
          COUNT(*) FILTER (WHERE status = 'timeout') as timeout_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'error') / COUNT(*)::NUMERIC, 2) as error_rate_pct
        FROM observability.traces
        WHERE service_name = $1
          AND start_time >= $2
          AND start_time < $3
        GROUP BY service_name, date_trunc('minute', start_time)
        ORDER BY minute DESC
        `,
        [serviceName, startTime, endTime],
      );

      return metrics;
    } catch (error) {
      console.error('Failed to fetch error rate:', error.message);
      return [];
    }
  }

  async getThroughput(serviceName, options = {}) {
    const { startTime = new Date(Date.now() - 3600000), endTime = new Date() } = options;

    try {
      const metrics = await prisma.raw(
        `
        SELECT
          service_name,
          date_trunc('minute', start_time) as minute,
          COUNT(*) as requests_per_minute,
          COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / COUNT(*)::NUMERIC * 100 as success_rate_pct
        FROM observability.traces
        WHERE service_name = $1
          AND start_time >= $2
          AND start_time < $3
        GROUP BY service_name, date_trunc('minute', start_time)
        ORDER BY minute DESC
        `,
        [serviceName, startTime, endTime],
      );

      return metrics;
    } catch (error) {
      console.error('Failed to fetch throughput:', error.message);
      return [];
    }
  }

  async getSLAStatus(organisationId, serviceName, limit = 10) {
    try {
      const records = await prisma.raw(
        `
        SELECT
          service_name, period_start, period_end,
          sla_target_pct, actual_uptime_pct,
          error_budget_remaining_minutes, error_budget_used_pct,
          burn_rate_pct_per_hour, alert_fired
        FROM observability.sla_burn_rate
        WHERE organisation_id = $1 AND service_name = $2
        ORDER BY period_start DESC
        LIMIT $3
        `,
        [organisationId, serviceName, limit],
      );

      return records;
    } catch (error) {
      console.error('Failed to fetch SLA status:', error.message);
      return [];
    }
  }

  async getMetricsByName(metricName, options = {}) {
    const { limit = 100, offset = 0, startTime, endTime, labels = {} } = options;

    let query = `
      SELECT id, metric_name, metric_type, labels, value, timestamp
      FROM observability.metrics
      WHERE metric_name = $1
    `;

    const params = [metricName];
    let paramIndex = 2;

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

    // Label filtering
    for (const [key, value] of Object.entries(labels)) {
      query += ` AND labels->>'${key}' = $${paramIndex}`;
      params.push(value);
      paramIndex += 1;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const metrics = await prisma.raw(query, params);
      return metrics.map((m) => ({
        ...m,
        labels: m.labels ? JSON.parse(m.labels) : {},
      }));
    } catch (error) {
      console.error('Failed to fetch metrics:', error.message);
      return [];
    }
  }

  async cleanup(retentionDays = 30) {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const result = await prisma.raw(
        `
        DELETE FROM observability.metrics
        WHERE created_at < $1
        `,
        [cutoffDate],
      );

      return result.rowCount || 0;
    } catch (error) {
      console.error('Failed to cleanup metrics:', error.message);
      return 0;
    }
  }
}

module.exports = new MetricsService();
