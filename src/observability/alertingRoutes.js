const express = require('express');
const alertingService = require('../services/system/alerting.service');

const createAlertingRoutes = () => {
  const router = express.Router();

  // POST /alerts/rules - Create alert rule
  router.post('/alerts/rules', async (req, res) => {
    const { name, condition, severity = 'warning', runbook_ref, notification_channels, cooldown_minutes } = req.body;
    const organisationId = req.organisationId;

    if (!name || !condition) {
      return res.status(400).json({ error: 'Required: name, condition' });
    }

    try {
      const rule = await alertingService.createAlertRule(organisationId, {
        name,
        condition,
        severity,
        runbook_ref,
        notification_channels,
        cooldown_minutes,
      });

      res.status(201).json(rule);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /alerts/rules - List alert rules
  router.get('/alerts/rules', async (req, res) => {
    const { enabled } = req.query;
    const organisationId = req.organisationId;

    try {
      const rules = await alertingService.getAlertRules(organisationId, {
        enabled: enabled === 'true',
      });

      res.json({ rules, count: rules.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /alerts/active - List active alerts
  router.get('/alerts/active', async (req, res) => {
    const { resolved = false } = req.query;
    const organisationId = req.organisationId;

    try {
      const alerts = await alertingService.getActiveAlerts(organisationId, {
        resolved: resolved === 'true',
      });

      res.json({ alerts, count: alerts.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /alerts/:alertId/acknowledge - Acknowledge alert
  router.post('/alerts/:alertId/acknowledge', async (req, res) => {
    const { alertId } = req.params;
    const organisationId = req.organisationId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
      const success = await alertingService.acknowledgeAlert(alertId, userId, organisationId);
      res.json({ success, message: success ? 'Alert acknowledged' : 'Failed to acknowledge' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /alerts/:alertId/resolve - Resolve alert
  router.post('/alerts/:alertId/resolve', async (req, res) => {
    const { alertId } = req.params;
    const { reason = '' } = req.body;
    const organisationId = req.organisationId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
      const success = await alertingService.resolveAlert(alertId, userId, organisationId, reason);
      res.json({ success, message: success ? 'Alert resolved' : 'Failed to resolve' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /alerts/rules/:ruleId/silence - Silence alert rule
  router.post('/alerts/rules/:ruleId/silence', async (req, res) => {
    const { ruleId } = req.params;
    const { until_minutes = 60, reason = 'Maintenance' } = req.body;
    const organisationId = req.organisationId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
      const untilTime = new Date(Date.now() + until_minutes * 60 * 1000);
      const success = await alertingService.silenceAlert(ruleId, organisationId, untilTime, reason, userId);

      res.json({
        success,
        message: success ? 'Alert silenced' : 'Failed to silence',
        until: untilTime,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /alerts/:alertId/history - Alert event history
  router.get('/alerts/:alertId/history', async (req, res) => {
    const { alertId } = req.params;
    const organisationId = req.organisationId;

    try {
      const history = await alertingService.getAlertHistory(alertId, organisationId);
      res.json({ alert_id: alertId, history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /alerts/stats - Alert statistics
  router.get('/alerts/stats', async (req, res) => {
    const { days = 7 } = req.query;
    const organisationId = req.organisationId;

    try {
      const stats = await alertingService.getAlertStats(organisationId, {
        days: parseInt(days),
      });

      res.json({ period_days: parseInt(days), stats });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /alerts/rules/:ruleId - Delete alert rule
  router.delete('/alerts/rules/:ruleId', async (req, res) => {
    const { ruleId } = req.params;
    const organisationId = req.organisationId;

    try {
      const success = await alertingService.deleteAlertRule(ruleId, organisationId);
      res.json({ success, message: success ? 'Rule deleted' : 'Failed to delete' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

module.exports = {
  createAlertingRoutes,
};
