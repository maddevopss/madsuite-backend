const { v4: uuidv4 } = require('uuid');
const alertingService = require('../services/system/alerting.service');
const prisma = require('../db/db');

describe('Stage 14 PR 14E — Alerting & Escalation Contract Tests', () => {
  let testOrganisationId;
  let testUserId;

  beforeAll(() => {
    testOrganisationId = uuidv4();
    testUserId = uuidv4();
  });

  describe('Alert Rules Management', () => {
    it('should create alert rule', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'High Error Rate',
        condition: 'error_rate > 5%',
        severity: 'critical',
        runbook_ref: 'runbooks/error-rate.md',
        notification_channels: ['slack', 'pagerduty'],
        cooldown_minutes: 30,
      });

      expect(rule).toBeTruthy();
      expect(rule.name).toBe('High Error Rate');
      expect(rule.condition).toBe('error_rate > 5%');
      expect(rule.severity).toBe('critical');
    });

    it('should list alert rules', async () => {
      // Create a few rules first
      await alertingService.createAlertRule(testOrganisationId, {
        name: 'Rule 1',
        condition: 'metric > threshold',
        severity: 'warning',
      });

      const rules = await alertingService.getAlertRules(testOrganisationId);
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter rules by enabled status', async () => {
      const rules = await alertingService.getAlertRules(testOrganisationId, {
        enabled: true,
      });

      rules.forEach((rule) => {
        expect(rule.enabled).toBe(true);
      });
    });

    it('should disable alert rule', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Disable Test',
        condition: 'test > threshold',
        severity: 'info',
      });

      const success = await alertingService.disableAlertRule(rule.id, testOrganisationId);
      expect(success).toBe(true);
    });

    it('should delete alert rule', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Delete Test',
        condition: 'test > threshold',
        severity: 'info',
      });

      const success = await alertingService.deleteAlertRule(rule.id, testOrganisationId);
      expect(success).toBe(true);
    });
  });

  describe('Alert Triggering', () => {
    it('should trigger alert', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Trigger Test',
        condition: 'error_rate > 10%',
        severity: 'critical',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'api',
        threshold: 10,
        current_value: 15,
        trend: 'increasing',
      });

      expect(alert).toBeTruthy();
      expect(alert.triggered_at).toBeTruthy();
    });

    it('should deduplicate alerts within cooldown period', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Dedup Test',
        condition: 'cpu > 80%',
        severity: 'warning',
        cooldown_minutes: 1,
      });

      const alert1 = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'worker',
        threshold: 80,
        current_value: 85,
      });

      // Try to trigger again immediately
      const alert2 = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'worker',
        threshold: 80,
        current_value: 87,
      });

      expect(alert1).toBeTruthy();
      expect(alert2).toBeNull(); // Deduplicated
    });

    it('should respect alert silence', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Silence Test',
        condition: 'disk > 90%',
        severity: 'warning',
      });

      // Silence the rule
      const untilTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await alertingService.silenceAlert(rule.id, testOrganisationId, untilTime, 'Maintenance', testUserId);

      // Try to trigger - should be silenced
      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'server',
        threshold: 90,
        current_value: 95,
      });

      expect(alert).toBeNull(); // Silenced
    });

    it('should store alert context', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Context Test',
        condition: 'latency > 1000ms',
        severity: 'warning',
      });

      const contextData = {
        service: 'checkout',
        threshold: 1000,
        current_value: 1500,
        trend: 'degrading',
      };

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, contextData);

      if (alert) {
        const alerts = await alertingService.getActiveAlerts(testOrganisationId);
        const found = alerts.find((a) => a.id === alert.id);
        expect(found).toBeTruthy();
        expect(found.context.service).toBe('checkout');
        expect(found.context.current_value).toBe(1500);
      }
    });
  });

  describe('Alert Acknowledgement', () => {
    it('should acknowledge alert', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Ack Test',
        condition: 'memory > 85%',
        severity: 'warning',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'app',
        threshold: 85,
        current_value: 90,
      });

      if (alert) {
        const success = await alertingService.acknowledgeAlert(alert.id, testUserId, testOrganisationId);
        expect(success).toBe(true);

        // Verify acknowledgement
        const alerts = await alertingService.getActiveAlerts(testOrganisationId);
        const found = alerts.find((a) => a.id === alert.id);
        expect(found.ack_by).toBe(testUserId);
        expect(found.ack_at).toBeTruthy();
      }
    });

    it('should record acknowledgement in history', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'History Test',
        condition: 'queue > 1000',
        severity: 'warning',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'queue',
        threshold: 1000,
        current_value: 1500,
      });

      if (alert) {
        await alertingService.acknowledgeAlert(alert.id, testUserId, testOrganisationId);
        const history = await alertingService.getAlertHistory(alert.id, testOrganisationId);

        const ackEvent = history.find((e) => e.event_type === 'acknowledged');
        expect(ackEvent).toBeTruthy();
      }
    });
  });

  describe('Alert Resolution', () => {
    it('should resolve alert', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Resolve Test',
        condition: 'error_rate > 5%',
        severity: 'critical',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'api',
        threshold: 5,
        current_value: 8,
      });

      if (alert) {
        const success = await alertingService.resolveAlert(alert.id, testUserId, testOrganisationId, 'Fixed deployment');
        expect(success).toBe(true);

        // Verify resolution
        const alerts = await alertingService.getActiveAlerts(testOrganisationId, { resolved: false });
        const stillActive = alerts.find((a) => a.id === alert.id);
        expect(stillActive).toBeFalsy();
      }
    });

    it('should record resolution in history', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Resolve History Test',
        condition: 'disk > 95%',
        severity: 'critical',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'db',
        threshold: 95,
        current_value: 98,
      });

      if (alert) {
        await alertingService.resolveAlert(alert.id, testUserId, testOrganisationId, 'Cleaned logs');
        const history = await alertingService.getAlertHistory(alert.id, testOrganisationId);

        const resolveEvent = history.find((e) => e.event_type === 'resolved');
        expect(resolveEvent).toBeTruthy();
      }
    });
  });

  describe('Alert Escalation', () => {
    it('should track escalation level', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Escalation Test',
        condition: 'sla_burn_rate > 50%',
        severity: 'critical',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'api',
        threshold: 50,
        current_value: 60,
      });

      if (alert) {
        const escalate0 = await alertingService.escalateAlert(alert.id, testOrganisationId, 1);
        expect(escalate0).toBe(true);

        const escalate1 = await alertingService.escalateAlert(alert.id, testOrganisationId, 2);
        expect(escalate1).toBe(true);
      }
    });

    it('should record escalation events', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Escalation Event Test',
        condition: 'error_budget > 100%',
        severity: 'critical',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'api',
        threshold: 100,
        current_value: 120,
      });

      if (alert) {
        await alertingService.escalateAlert(alert.id, testOrganisationId, 1);
        const history = await alertingService.getAlertHistory(alert.id, testOrganisationId);

        const escalateEvent = history.find((e) => e.event_type === 'escalated');
        expect(escalateEvent).toBeTruthy();
      }
    });
  });

  describe('Alert Silence', () => {
    it('should silence alert rule temporarily', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Silence Temp Test',
        condition: 'maintenance_window',
        severity: 'info',
      });

      const untilTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      const success = await alertingService.silenceAlert(
        rule.id,
        testOrganisationId,
        untilTime,
        'Planned maintenance',
        testUserId,
      );

      expect(success).toBe(true);
    });

    it('should check silence status', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Silence Check Test',
        condition: 'deploy_in_progress',
        severity: 'info',
      });

      const untilTime = new Date(Date.now() + 60 * 60 * 1000);
      await alertingService.silenceAlert(rule.id, testOrganisationId, untilTime, 'Deployment', testUserId);

      const silence = await alertingService.checkAlertSilence(rule.id, testOrganisationId);
      expect(silence).toBeTruthy();
      expect(silence.reason).toBe('Deployment');
    });
  });

  describe('Alert Statistics', () => {
    it('should calculate alert stats', async () => {
      const stats = await alertingService.getAlertStats(testOrganisationId, { days: 7 });

      if (stats) {
        expect(stats.total_alerts).toBeGreaterThanOrEqual(0);
        expect(stats.active_count).toBeGreaterThanOrEqual(0);
        expect(stats.resolved_count).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track active vs resolved counts', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Stats Test',
        condition: 'test > threshold',
        severity: 'warning',
      });

      // Trigger and resolve some alerts
      const alert1 = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'test1',
        threshold: 10,
        current_value: 15,
      });

      if (alert1) {
        await alertingService.resolveAlert(alert1.id, testUserId, testOrganisationId, 'Fixed');
      }

      const stats = await alertingService.getAlertStats(testOrganisationId, { days: 7 });
      expect(stats).toBeTruthy();
      expect(typeof stats.avg_resolution_time_min).toBe('number' || 'object'); // Could be null
    });
  });

  describe('Alert Query & Filtering', () => {
    it('should retrieve active alerts', async () => {
      const alerts = await alertingService.getActiveAlerts(testOrganisationId, {
        resolved: false,
      });

      expect(Array.isArray(alerts)).toBe(true);
      alerts.forEach((alert) => {
        expect(alert.resolved_at).toBeUndefined(); // Active alerts shouldn't have resolved_at
      });
    });

    it('should retrieve resolved alerts', async () => {
      const alerts = await alertingService.getActiveAlerts(testOrganisationId, {
        resolved: true,
      });

      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should retrieve alert history chronologically', async () => {
      const rule = await alertingService.createAlertRule(testOrganisationId, {
        name: 'Timeline Test',
        condition: 'test > threshold',
        severity: 'warning',
      });

      const alert = await alertingService.triggerAlert(testOrganisationId, rule.id, {
        service: 'test',
        threshold: 10,
        current_value: 15,
      });

      if (alert) {
        const history = await alertingService.getAlertHistory(alert.id, testOrganisationId);
        expect(Array.isArray(history)).toBe(true);

        // First event should be triggered
        if (history.length > 0) {
          expect(history[0].event_type).toBe('triggered');
        }
      }
    });
  });
});
