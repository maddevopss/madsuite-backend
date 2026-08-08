/**
 * Advanced Analytics Routes
 * Real-time analytics, insights, custom reports, and alerts
 * @module routes/analytics-advanced
 */

const express = require('express');
const router = express.Router();
const analyticsService = require('../services/real-time-analytics.service');
const { authenticate } = require('../middleware/auth');
const logger = require('../config/logger');

// Middleware to ensure authentication
router.use(authenticate);

/**
 * POST /api/analytics/metrics
 * Record a real-time metric
 * @body {string} metricName - Metric name (required)
 * @body {number} metricValue - Metric value (required)
 * @body {string} metricType - Metric type (optional, default: 'gauge')
 * @body {string} unit - Unit of measurement (optional)
 * @body {Object} tags - Tags for the metric (optional)
 * @body {Object} metadata - Additional metadata (optional)
 * @returns {Object} Created metric
 */
router.post('/metrics', async (req, res) => {
  try {
    const { metricName, metricValue, metricType, unit, tags, metadata } = req.body;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    if (!metricName || metricValue === undefined) {
      return res.status(400).json({ error: 'metricName and metricValue are required' });
    }

    const metric = await analyticsService.recordMetric(
      organisationId,
      metricName,
      metricValue,
      {
        userId,
        metricType,
        unit,
        tags,
        metadata
      }
    );

    res.status(201).json(metric);
  } catch (error) {
    logger.error('Error recording metric:', error);
    res.status(500).json({ error: 'Failed to record metric' });
  }
});

/**
 * GET /api/analytics/metrics
 * Get real-time metrics
 * @query {string} metricName - Filter by metric name (optional)
 * @query {number} limit - Number of results (default: 100)
 * @query {number} offset - Pagination offset (default: 0)
 * @query {number} timeRange - Time range in seconds (default: 3600)
 * @returns {Array} Metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const { metricName, limit = 100, offset = 0, timeRange = 3600 } = req.query;
    const organisationId = req.user.organisation_id;

    const metrics = await analyticsService.getRealtimeMetrics(
      organisationId,
      {
        metricName,
        limit: Math.min(parseInt(limit, 10), 1000),
        offset: parseInt(offset, 10),
        timeRange: parseInt(timeRange, 10)
      }
    );

    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * GET /api/analytics/metrics/:metricName/stats
 * Get metric statistics
 * @param {string} metricName - Metric name
 * @query {number} timeRange - Time range in seconds (default: 3600)
 * @returns {Object} Metric statistics
 */
router.get('/metrics/:metricName/stats', async (req, res) => {
  try {
    const { metricName } = req.params;
    const { timeRange = 3600 } = req.query;
    const organisationId = req.user.organisation_id;

    const stats = await analyticsService.getMetricStats(
      organisationId,
      metricName,
      { timeRange: parseInt(timeRange, 10) }
    );

    if (!stats) {
      return res.status(404).json({ error: 'No metrics found for this metric name' });
    }

    res.json(stats);
  } catch (error) {
    logger.error('Error fetching metric stats:', error);
    res.status(500).json({ error: 'Failed to fetch metric stats' });
  }
});

/**
 * POST /api/analytics/insights
 * Create an insight
 * @body {string} insightType - Insight type (required)
 * @body {string} title - Insight title (required)
 * @body {string} description - Insight description (optional)
 * @body {Object} insightContent - Insight content (required)
 * @body {number} confidenceScore - Confidence score 0-1 (optional)
 * @body {number} relevanceScore - Relevance score 0-1 (optional)
 * @body {string} actionUrl - Action URL (optional)
 * @body {string} actionLabel - Action label (optional)
 * @returns {Object} Created insight
 */
router.post('/insights', async (req, res) => {
  try {
    const {
      insightType,
      title,
      description,
      insightContent,
      confidenceScore,
      relevanceScore,
      actionUrl,
      actionLabel,
      expiresAt,
      metadata
    } = req.body;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    if (!insightType || !title || !insightContent) {
      return res.status(400).json({ error: 'insightType, title, and insightContent are required' });
    }

    const insight = await analyticsService.createInsight(
      organisationId,
      {
        userId,
        insightType,
        title,
        description,
        insightContent,
        confidenceScore,
        relevanceScore,
        actionUrl,
        actionLabel,
        expiresAt,
        metadata
      }
    );

    res.status(201).json(insight);
  } catch (error) {
    logger.error('Error creating insight:', error);
    res.status(500).json({ error: 'Failed to create insight' });
  }
});

/**
 * GET /api/analytics/insights
 * Get insights
 * @query {string} insightType - Filter by insight type (optional)
 * @query {string} status - Filter by status (default: 'active')
 * @query {number} minConfidence - Minimum confidence score (default: 0)
 * @query {number} limit - Number of results (default: 50)
 * @query {number} offset - Pagination offset (default: 0)
 * @returns {Array} Insights
 */
router.get('/insights', async (req, res) => {
  try {
    const {
      insightType,
      status = 'active',
      minConfidence = 0,
      limit = 50,
      offset = 0
    } = req.query;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    const insights = await analyticsService.getInsights(
      organisationId,
      {
        userId,
        insightType,
        status,
        minConfidence: parseFloat(minConfidence),
        limit: Math.min(parseInt(limit, 10), 500),
        offset: parseInt(offset, 10)
      }
    );

    res.json(insights);
  } catch (error) {
    logger.error('Error fetching insights:', error);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

/**
 * POST /api/analytics/insights/:insightId/dismiss
 * Dismiss an insight
 * @param {string} insightId - Insight ID
 * @returns {Object} Updated insight
 */
router.post('/insights/:insightId/dismiss', async (req, res) => {
  try {
    const { insightId } = req.params;
    const organisationId = req.user.organisation_id;

    const insight = await analyticsService.dismissInsight(organisationId, insightId);

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    res.json(insight);
  } catch (error) {
    logger.error('Error dismissing insight:', error);
    res.status(500).json({ error: 'Failed to dismiss insight' });
  }
});

/**
 * POST /api/analytics/insights/:insightId/interactions
 * Record insight interaction
 * @param {string} insightId - Insight ID
 * @body {string} interactionType - Interaction type (required)
 * @body {Object} metadata - Additional metadata (optional)
 * @returns {Object} Created interaction
 */
router.post('/insights/:insightId/interactions', async (req, res) => {
  try {
    const { insightId } = req.params;
    const { interactionType, metadata } = req.body;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    if (!interactionType) {
      return res.status(400).json({ error: 'interactionType is required' });
    }

    const interaction = await analyticsService.recordInsightInteraction(
      organisationId,
      userId,
      insightId,
      interactionType,
      metadata
    );

    res.status(201).json(interaction);
  } catch (error) {
    logger.error('Error recording insight interaction:', error);
    res.status(500).json({ error: 'Failed to record interaction' });
  }
});

/**
 * POST /api/reports/custom
 * Create a custom report
 * @body {string} reportName - Report name (required)
 * @body {string} reportType - Report type (required)
 * @body {Array} metrics - Metrics configuration (required)
 * @body {Object} filters - Report filters (optional)
 * @body {Object} grouping - Grouping configuration (optional)
 * @body {string} chartType - Chart type (optional)
 * @returns {Object} Created report
 */
router.post('/custom', async (req, res) => {
  try {
    const {
      reportName,
      description,
      reportType,
      metrics,
      filters,
      grouping,
      chartType,
      dateRange,
      refreshInterval,
      isPublic,
      isScheduled,
      scheduleCron,
      recipients,
      metadata
    } = req.body;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    if (!reportName || !reportType || !metrics) {
      return res.status(400).json({ error: 'reportName, reportType, and metrics are required' });
    }

    const report = await analyticsService.createCustomReport(
      organisationId,
      userId,
      {
        reportName,
        description,
        reportType,
        metrics,
        filters,
        grouping,
        chartType,
        dateRange,
        refreshInterval,
        isPublic,
        isScheduled,
        scheduleCron,
        recipients,
        metadata
      }
    );

    res.status(201).json(report);
  } catch (error) {
    logger.error('Error creating custom report:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

/**
 * GET /api/reports/custom
 * Get custom reports
 * @query {string} reportType - Filter by report type (optional)
 * @query {number} limit - Number of results (default: 50)
 * @query {number} offset - Pagination offset (default: 0)
 * @returns {Array} Reports
 */
router.get('/custom', async (req, res) => {
  try {
    const { reportType, limit = 50, offset = 0 } = req.query;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    const reports = await analyticsService.getCustomReports(
      organisationId,
      {
        userId,
        reportType,
        limit: Math.min(parseInt(limit, 10), 500),
        offset: parseInt(offset, 10)
      }
    );

    res.json(reports);
  } catch (error) {
    logger.error('Error fetching custom reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * GET /api/reports/custom/:reportId
 * Get a custom report by ID
 * @param {string} reportId - Report ID
 * @returns {Object} Report
 */
router.get('/custom/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const organisationId = req.user.organisation_id;

    const report = await analyticsService.getCustomReportById(organisationId, reportId);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error) {
    logger.error('Error fetching custom report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

/**
 * PUT /api/reports/custom/:reportId
 * Update a custom report
 * @param {string} reportId - Report ID
 * @body {Object} updates - Fields to update
 * @returns {Object} Updated report
 */
router.put('/custom/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const organisationId = req.user.organisation_id;

    const report = await analyticsService.updateCustomReport(organisationId, reportId, req.body);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error) {
    logger.error('Error updating custom report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

/**
 * POST /api/alerts
 * Create an alert
 * @body {string} alertName - Alert name (required)
 * @body {string} alertType - Alert type (required)
 * @body {string} metricName - Metric name (required)
 * @body {string} condition - Condition (required)
 * @body {number} thresholdValue - Threshold value (optional)
 * @returns {Object} Created alert
 */
router.post('/alerts', async (req, res) => {
  try {
    const {
      alertName,
      description,
      alertType,
      metricName,
      condition,
      thresholdValue,
      thresholdUpper,
      thresholdLower,
      severity,
      notificationChannels,
      recipients,
      webhookUrl,
      metadata
    } = req.body;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    if (!alertName || !alertType || !metricName || !condition) {
      return res.status(400).json({ error: 'alertName, alertType, metricName, and condition are required' });
    }

    const alert = await analyticsService.createAlert(
      organisationId,
      userId,
      {
        alertName,
        description,
        alertType,
        metricName,
        condition,
        thresholdValue,
        thresholdUpper,
        thresholdLower,
        severity,
        notificationChannels,
        recipients,
        webhookUrl,
        metadata
      }
    );

    res.status(201).json(alert);
  } catch (error) {
    logger.error('Error creating alert:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

/**
 * GET /api/alerts
 * Get alerts
 * @query {string} alertType - Filter by alert type (optional)
 * @query {boolean} isEnabled - Filter by enabled status (default: true)
 * @query {number} limit - Number of results (default: 50)
 * @query {number} offset - Pagination offset (default: 0)
 * @returns {Array} Alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const { alertType, isEnabled = true, limit = 50, offset = 0 } = req.query;
    const organisationId = req.user.organisation_id;
    const userId = req.user.id;

    const alerts = await analyticsService.getAlerts(
      organisationId,
      {
        userId,
        alertType,
        isEnabled: isEnabled === 'true',
        limit: Math.min(parseInt(limit, 10), 500),
        offset: parseInt(offset, 10)
      }
    );

    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * PUT /api/alerts/:alertId/status
 * Update alert status
 * @param {string} alertId - Alert ID
 * @body {boolean} isEnabled - Enable/disable alert
 * @returns {Object} Updated alert
 */
router.put('/alerts/:alertId/status', async (req, res) => {
  try {
    const { alertId } = req.params;
    const { isEnabled } = req.body;
    const organisationId = req.user.organisation_id;

    if (isEnabled === undefined) {
      return res.status(400).json({ error: 'isEnabled is required' });
    }

    const alert = await analyticsService.updateAlertStatus(organisationId, alertId, isEnabled);

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(alert);
  } catch (error) {
    logger.error('Error updating alert status:', error);
    res.status(500).json({ error: 'Failed to update alert status' });
  }
});

/**
 * GET /api/analytics/snapshots/:metricName
 * Get metric snapshots
 * @param {string} metricName - Metric name
 * @query {string} aggregationType - Aggregation type (default: 'daily')
 * @query {string} startDate - Start date (optional)
 * @query {string} endDate - End date (optional)
 * @query {number} limit - Number of results (default: 100)
 * @returns {Array} Snapshots
 */
router.get('/snapshots/:metricName', async (req, res) => {
  try {
    const { metricName } = req.params;
    const { aggregationType = 'daily', startDate, endDate, limit = 100, offset = 0 } = req.query;
    const organisationId = req.user.organisation_id;

    const snapshots = await analyticsService.getMetricSnapshots(
      organisationId,
      metricName,
      {
        aggregationType,
        startDate,
        endDate,
        limit: Math.min(parseInt(limit, 10), 1000),
        offset: parseInt(offset, 10)
      }
    );

    res.json(snapshots);
  } catch (error) {
    logger.error('Error fetching metric snapshots:', error);
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

module.exports = router;
