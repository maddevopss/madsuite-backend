/**
 * Real-time Analytics Service
 * Manages real-time metrics, insights, custom reports, and alerts
 * @module services/real-time-analytics
 */

const db = require('../db');
const logger = require('../config/logger');

/**
 * Record a real-time metric
 * @param {string} organisationId - Organisation ID
 * @param {string} metricName - Metric name
 * @param {number} metricValue - Metric value
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Created metric
 */
async function recordMetric(organisationId, metricName, metricValue, options = {}) {
  const {
    userId = null,
    metricType = 'gauge',
    unit = null,
    tags = {},
    metadata = {}
  } = options;

  try {
    const result = await db.query(
      `INSERT INTO real_time_metrics (
        organisation_id, user_id, metric_name, metric_type, metric_value, unit, tags, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [organisationId, userId, metricName, metricType, metricValue, unit, JSON.stringify(tags), JSON.stringify(metadata)]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error recording metric:', error);
    throw error;
  }
}

/**
 * Get real-time metrics
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Metrics
 */
async function getRealtimeMetrics(organisationId, options = {}) {
  const {
    metricName = null,
    limit = 100,
    offset = 0,
    timeRange = 3600 // seconds (default: 1 hour)
  } = options;

  try {
    let query = `
      SELECT * FROM real_time_metrics
      WHERE organisation_id = $1
      AND timestamp > NOW() - INTERVAL '${timeRange} seconds'
    `;
    const params = [organisationId];

    if (metricName) {
      query += ` AND metric_name = $${params.length + 1}`;
      params.push(metricName);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching real-time metrics:', error);
    throw error;
  }
}

/**
 * Get metric statistics
 * @param {string} organisationId - Organisation ID
 * @param {string} metricName - Metric name
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Metric statistics
 */
async function getMetricStats(organisationId, metricName, options = {}) {
  const { timeRange = 3600 } = options;

  try {
    const result = await db.query(
      `SELECT
        metric_name,
        COUNT(*) as count,
        AVG(metric_value) as average,
        MIN(metric_value) as minimum,
        MAX(metric_value) as maximum,
        STDDEV(metric_value) as stddev,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY metric_value) as median
      FROM real_time_metrics
      WHERE organisation_id = $1
      AND metric_name = $2
      AND timestamp > NOW() - INTERVAL '${timeRange} seconds'
      GROUP BY metric_name`,
      [organisationId, metricName]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error calculating metric stats:', error);
    throw error;
  }
}

/**
 * Create an insight
 * @param {string} organisationId - Organisation ID
 * @param {Object} insightData - Insight data
 * @returns {Promise<Object>} Created insight
 */
async function createInsight(organisationId, insightData) {
  const {
    userId = null,
    insightType,
    title,
    description = null,
    insightContent,
    confidenceScore = 0.5,
    relevanceScore = 0.5,
    actionUrl = null,
    actionLabel = null,
    expiresAt = null,
    metadata = {}
  } = insightData;

  try {
    const result = await db.query(
      `INSERT INTO analytics_insights (
        organisation_id, user_id, insight_type, title, description, insight_data,
        confidence_score, relevance_score, action_url, action_label, expires_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        organisationId, userId, insightType, title, description, JSON.stringify(insightContent),
        confidenceScore, relevanceScore, actionUrl, actionLabel, expiresAt, JSON.stringify(metadata)
      ]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error creating insight:', error);
    throw error;
  }
}

/**
 * Get insights
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Insights
 */
async function getInsights(organisationId, options = {}) {
  const {
    userId = null,
    insightType = null,
    status = 'active',
    limit = 50,
    offset = 0,
    minConfidence = 0
  } = options;

  try {
    let query = `
      SELECT * FROM analytics_insights
      WHERE organisation_id = $1
      AND status = $2
      AND confidence_score >= $3
      AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const params = [organisationId, status, minConfidence];

    if (userId) {
      query += ` AND user_id = $${params.length + 1}`;
      params.push(userId);
    }

    if (insightType) {
      query += ` AND insight_type = $${params.length + 1}`;
      params.push(insightType);
    }

    query += ` ORDER BY confidence_score DESC, generated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching insights:', error);
    throw error;
  }
}

/**
 * Dismiss an insight
 * @param {string} organisationId - Organisation ID
 * @param {string} insightId - Insight ID
 * @returns {Promise<Object>} Updated insight
 */
async function dismissInsight(organisationId, insightId) {
  try {
    const result = await db.query(
      `UPDATE analytics_insights
      SET status = 'dismissed'
      WHERE id = $1 AND organisation_id = $2
      RETURNING *`,
      [insightId, organisationId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error dismissing insight:', error);
    throw error;
  }
}

/**
 * Record insight interaction
 * @param {string} organisationId - Organisation ID
 * @param {string} userId - User ID
 * @param {string} insightId - Insight ID
 * @param {string} interactionType - Interaction type
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Created interaction
 */
async function recordInsightInteraction(organisationId, userId, insightId, interactionType, metadata = {}) {
  try {
    const result = await db.query(
      `INSERT INTO insight_interactions (
        organisation_id, user_id, insight_id, interaction_type, metadata
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [organisationId, userId, insightId, interactionType, JSON.stringify(metadata)]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error recording insight interaction:', error);
    throw error;
  }
}

/**
 * Create a custom report
 * @param {string} organisationId - Organisation ID
 * @param {string} userId - User ID
 * @param {Object} reportData - Report configuration
 * @returns {Promise<Object>} Created report
 */
async function createCustomReport(organisationId, userId, reportData) {
  const {
    reportName,
    description = null,
    reportType,
    metrics,
    filters = {},
    grouping = {},
    chartType = 'line',
    dateRange = { start: null, end: null },
    refreshInterval = 'manual',
    isPublic = false,
    isScheduled = false,
    scheduleCron = null,
    recipients = [],
    metadata = {}
  } = reportData;

  try {
    const result = await db.query(
      `INSERT INTO custom_reports (
        organisation_id, user_id, report_name, description, report_type, metrics,
        filters, grouping, chart_type, date_range, refresh_interval, is_public,
        is_scheduled, schedule_cron, recipients, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        organisationId, userId, reportName, description, reportType, JSON.stringify(metrics),
        JSON.stringify(filters), JSON.stringify(grouping), chartType, JSON.stringify(dateRange),
        refreshInterval, isPublic, isScheduled, scheduleCron, JSON.stringify(recipients), JSON.stringify(metadata)
      ]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error creating custom report:', error);
    throw error;
  }
}

/**
 * Get custom reports
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Reports
 */
async function getCustomReports(organisationId, options = {}) {
  const {
    userId = null,
    reportType = null,
    status = 'active',
    limit = 50,
    offset = 0
  } = options;

  try {
    let query = `
      SELECT * FROM custom_reports
      WHERE organisation_id = $1 AND status = $2
    `;
    const params = [organisationId, status];

    if (userId) {
      query += ` AND user_id = $${params.length + 1}`;
      params.push(userId);
    }

    if (reportType) {
      query += ` AND report_type = $${params.length + 1}`;
      params.push(reportType);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching custom reports:', error);
    throw error;
  }
}

/**
 * Get a custom report by ID
 * @param {string} organisationId - Organisation ID
 * @param {string} reportId - Report ID
 * @returns {Promise<Object>} Report
 */
async function getCustomReportById(organisationId, reportId) {
  try {
    const result = await db.query(
      `SELECT * FROM custom_reports WHERE id = $1 AND organisation_id = $2`,
      [reportId, organisationId]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching custom report:', error);
    throw error;
  }
}

/**
 * Update a custom report
 * @param {string} organisationId - Organisation ID
 * @param {string} reportId - Report ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated report
 */
async function updateCustomReport(organisationId, reportId, updates) {
  try {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = $${paramCount}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
      paramCount++;
    });

    values.push(reportId, organisationId);

    const query = `
      UPDATE custom_reports
      SET ${fields.join(', ')}
      WHERE id = $${paramCount} AND organisation_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating custom report:', error);
    throw error;
  }
}

/**
 * Create an alert
 * @param {string} organisationId - Organisation ID
 * @param {string} userId - User ID
 * @param {Object} alertData - Alert configuration
 * @returns {Promise<Object>} Created alert
 */
async function createAlert(organisationId, userId, alertData) {
  const {
    alertName,
    description = null,
    alertType,
    metricName,
    condition,
    thresholdValue = null,
    thresholdUpper = null,
    thresholdLower = null,
    severity = 'medium',
    notificationChannels = ['email'],
    recipients = [],
    webhookUrl = null,
    metadata = {}
  } = alertData;

  try {
    const result = await db.query(
      `INSERT INTO analytics_alerts (
        organisation_id, user_id, alert_name, description, alert_type, metric_name,
        condition, threshold_value, threshold_upper, threshold_lower, severity,
        notification_channels, recipients, webhook_url, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        organisationId, userId, alertName, description, alertType, metricName,
        condition, thresholdValue, thresholdUpper, thresholdLower, severity,
        JSON.stringify(notificationChannels), JSON.stringify(recipients), webhookUrl, JSON.stringify(metadata)
      ]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error creating alert:', error);
    throw error;
  }
}

/**
 * Get alerts
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Alerts
 */
async function getAlerts(organisationId, options = {}) {
  const {
    userId = null,
    alertType = null,
    isEnabled = true,
    limit = 50,
    offset = 0
  } = options;

  try {
    let query = `
      SELECT * FROM analytics_alerts
      WHERE organisation_id = $1 AND is_enabled = $2
    `;
    const params = [organisationId, isEnabled];

    if (userId) {
      query += ` AND user_id = $${params.length + 1}`;
      params.push(userId);
    }

    if (alertType) {
      query += ` AND alert_type = $${params.length + 1}`;
      params.push(alertType);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    throw error;
  }
}

/**
 * Update alert status
 * @param {string} organisationId - Organisation ID
 * @param {string} alertId - Alert ID
 * @param {boolean} isEnabled - Enable/disable alert
 * @returns {Promise<Object>} Updated alert
 */
async function updateAlertStatus(organisationId, alertId, isEnabled) {
  try {
    const result = await db.query(
      `UPDATE analytics_alerts
      SET is_enabled = $1
      WHERE id = $2 AND organisation_id = $3
      RETURNING *`,
      [isEnabled, alertId, organisationId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error updating alert status:', error);
    throw error;
  }
}

/**
 * Record alert trigger
 * @param {string} organisationId - Organisation ID
 * @param {string} alertId - Alert ID
 * @returns {Promise<Object>} Updated alert
 */
async function recordAlertTrigger(organisationId, alertId) {
  try {
    const result = await db.query(
      `UPDATE analytics_alerts
      SET last_triggered_at = NOW(), trigger_count = trigger_count + 1
      WHERE id = $1 AND organisation_id = $2
      RETURNING *`,
      [alertId, organisationId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error recording alert trigger:', error);
    throw error;
  }
}

/**
 * Create metric snapshot
 * @param {string} organisationId - Organisation ID
 * @param {string} metricName - Metric name
 * @param {Object} snapshotData - Snapshot data
 * @param {string} aggregationType - Aggregation type
 * @returns {Promise<Object>} Created snapshot
 */
async function createMetricSnapshot(organisationId, metricName, snapshotData, aggregationType = 'hourly') {
  try {
    const now = new Date();
    const result = await db.query(
      `INSERT INTO metric_snapshots (
        organisation_id, metric_name, snapshot_data, aggregation_type, snapshot_date, snapshot_time
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [organisationId, metricName, JSON.stringify(snapshotData), aggregationType, now, now]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error creating metric snapshot:', error);
    throw error;
  }
}

/**
 * Get metric snapshots
 * @param {string} organisationId - Organisation ID
 * @param {string} metricName - Metric name
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Snapshots
 */
async function getMetricSnapshots(organisationId, metricName, options = {}) {
  const {
    aggregationType = 'daily',
    limit = 100,
    offset = 0,
    startDate = null,
    endDate = null
  } = options;

  try {
    let query = `
      SELECT * FROM metric_snapshots
      WHERE organisation_id = $1 AND metric_name = $2 AND aggregation_type = $3
    `;
    const params = [organisationId, metricName, aggregationType];

    if (startDate) {
      query += ` AND snapshot_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND snapshot_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` ORDER BY snapshot_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching metric snapshots:', error);
    throw error;
  }
}

module.exports = {
  recordMetric,
  getRealtimeMetrics,
  getMetricStats,
  createInsight,
  getInsights,
  dismissInsight,
  recordInsightInteraction,
  createCustomReport,
  getCustomReports,
  getCustomReportById,
  updateCustomReport,
  createAlert,
  getAlerts,
  updateAlertStatus,
  recordAlertTrigger,
  createMetricSnapshot,
  getMetricSnapshots
};
