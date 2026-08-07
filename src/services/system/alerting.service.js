const prisma = require('../../../db');

class AlertingService {
  constructor() {
    this.alertHistory = new Map(); // In-memory deduplication (local process)
    this.escalationTimers = new Map();
  }

  async createAlertRule(organisationId, ruleData) {
    const {
      name,
      condition,
      severity = 'warning',
      runbook_ref,
      notification_channels = [],
      cooldown_minutes = 30,
    } = ruleData;

    try {
      const result = await prisma.query(
        `
        INSERT INTO observability.alert_rules (
          organisation_id, name, condition, severity, runbook_ref,
          notification_channels, cooldown_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, condition, severity
        `,
        [
          organisationId,
          name,
          condition,
          severity,
          runbook_ref || null,
          notification_channels,
          cooldown_minutes,
        ],
      );

      return result.rows[0];
    } catch (error) {
      console.error('Failed to create alert rule:', error.message);
      return null;
    }
  }

  async getAlertRules(organisationId, options = {}) {
    const { enabled } = options;

    let query = `
      SELECT id, name, condition, severity, enabled, runbook_ref,
             notification_channels, cooldown_minutes, created_at
      FROM observability.alert_rules
      WHERE organisation_id = $1
    `;

    const params = [organisationId];

    if (enabled !== undefined) {
      query += ` AND enabled = $2`;
      params.push(enabled);
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const rules = await prisma.query(query, params);
      return rules.rows;
    } catch (error) {
      console.error('Failed to fetch alert rules:', error.message);
      return [];
    }
  }

  async checkAlertSilence(ruleId, organisationId) {
    try {
      const silence = await prisma.query(
        `
        SELECT id, until_at, reason
        FROM observability.alert_silences
        WHERE rule_id = $1
          AND organisation_id = $2
          AND until_at > NOW()
        LIMIT 1
        `,
        [ruleId, organisationId],
      );

      return silence.rows[0] || null;
    } catch (error) {
      console.error('Failed to check alert silence:', error.message);
      return null;
    }
  }

  async triggerAlert(organisationId, ruleId, alertData) {
    const { service, threshold, current_value, trend } = alertData;

    // Check if silence active
    const silence = await this.checkAlertSilence(ruleId, organisationId);
    if (silence) {
      console.log(`Alert silenced until ${silence.until_at}: ${silence.reason}`);
      return null;
    }

    // Local deduplication: don't alert twice in quick succession
    const dedupeKey = `${ruleId}:${service}`;
    const lastAlert = this.alertHistory.get(dedupeKey);
    if (lastAlert && Date.now() - lastAlert < 60000) {
      // Less than 1 minute since last alert
      return null;
    }

    try {
      const result = await prisma.query(
        `
        INSERT INTO observability.active_alerts (
          rule_id, organisation_id, triggered_at, context
        ) VALUES ($1, $2, $3, $4)
        RETURNING id, triggered_at
        `,
        [
          ruleId,
          organisationId,
          new Date(),
          JSON.stringify({
            service,
            threshold,
            current_value,
            trend,
          }),
        ],
      );

      const alert = result.rows[0];
      this.alertHistory.set(dedupeKey, Date.now());

      // Schedule escalation
      this.scheduleEscalation(alert.id, organisationId);

      return alert;
    } catch (error) {
      console.error('Failed to trigger alert:', error.message);
      return null;
    }
  }

  async acknowledgeAlert(alertId, userId, organisationId) {
    try {
      await prisma.query(
        `
        UPDATE observability.active_alerts
        SET ack_by = $1, ack_at = $2
        WHERE id = $3 AND organisation_id = $4
        `,
        [userId, new Date(), alertId, organisationId],
      );

      // Record in history
      await this.recordAlertEvent(alertId, 'acknowledged', userId, {
        message: 'Alert acknowledged by user',
      });

      return true;
    } catch (error) {
      console.error('Failed to acknowledge alert:', error.message);
      return false;
    }
  }

  async escalateAlert(alertId, organisationId, escalationLevel) {
    try {
      await prisma.query(
        `
        UPDATE observability.active_alerts
        SET escalation_level = $1, escalated_at = $2
        WHERE id = $3 AND organisation_id = $4
        `,
        [escalationLevel, new Date(), alertId, organisationId],
      );

      // Record in history
      await this.recordAlertEvent(alertId, 'escalated', null, {
        message: `Alert escalated to level ${escalationLevel}`,
        escalation_level: escalationLevel,
      });

      return true;
    } catch (error) {
      console.error('Failed to escalate alert:', error.message);
      return false;
    }
  }

  scheduleEscalation(alertId, organisationId) {
    // Schedule escalation checks: 5 min, 30 min, 60 min if not acked
    const escalationTimes = [5, 30, 60]; // minutes
    let currentIndex = 0;

    const checkEscalation = async () => {
      if (currentIndex < escalationTimes.length) {
        const delayMs = escalationTimes[currentIndex] * 60 * 1000;

        const timerKey = `${alertId}:${currentIndex}`;
        const timer = setTimeout(async () => {
          try {
            // Check if still unacked
            const alert = await prisma.query(
              `
              SELECT ack_at FROM observability.active_alerts
              WHERE id = $1 AND organisation_id = $2
              `,
              [alertId, organisationId],
            );

            if (alert.rows[0] && !alert.rows[0].ack_at) {
              // Still unacked, escalate
              await this.escalateAlert(alertId, organisationId, currentIndex + 1);
              currentIndex += 1;
              checkEscalation(); // Schedule next escalation
            }
          } catch (error) {
            // A timer may outlive a test/request pool; never leak an unhandled rejection.
            console.error('Failed to check alert escalation:', error.message);
          } finally {
            this.escalationTimers.delete(timerKey);
          }
        }, delayMs);

        // Escalation must not keep a short-lived test/worker process alive.
        if (typeof timer.unref === 'function') timer.unref();
        this.escalationTimers.set(timerKey, timer);
      }
    };

    checkEscalation();
  }

  async resolveAlert(alertId, userId, organisationId, reason = '') {
    try {
      await prisma.query(
        `
        UPDATE observability.active_alerts
        SET resolved_at = $1
        WHERE id = $2 AND organisation_id = $3
        `,
        [new Date(), alertId, organisationId],
      );

      // Record in history
      await this.recordAlertEvent(alertId, 'resolved', userId, {
        message: `Alert resolved: ${reason}`,
      });

      // Clear escalation timers
      for (const key of this.escalationTimers.keys()) {
        if (key.startsWith(`${alertId}:`)) {
          clearTimeout(this.escalationTimers.get(key));
          this.escalationTimers.delete(key);
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to resolve alert:', error.message);
      return false;
    }
  }

  async silenceAlert(ruleId, organisationId, untilTime, reason, userId) {
    try {
      await prisma.query(
        `
        INSERT INTO observability.alert_silences (
          rule_id, organisation_id, silenced_by, until_at, reason
        ) VALUES ($1, $2, $3, $4, $5)
        `,
        [ruleId, organisationId, userId, untilTime, reason],
      );

      return true;
    } catch (error) {
      console.error('Failed to silence alert:', error.message);
      return false;
    }
  }

  async recordAlertEvent(alertId, eventType, userId, context = {}) {
    try {
      await prisma.query(
        `
        INSERT INTO observability.alert_history (
          alert_id, event_type, event_at, actor_id, context
        ) VALUES ($1, $2, $3, $4, $5)
        `,
        [alertId, eventType, new Date(), userId || null, JSON.stringify(context)],
      );
    } catch (error) {
      console.error('Failed to record alert event:', error.message);
    }
  }

  async getActiveAlerts(organisationId, options = {}) {
    const { resolved = false } = options;

    let query = `
      SELECT id, rule_id, triggered_at, ack_by, ack_at, escalated_at,
             escalation_level, resolved_at, context
      FROM observability.active_alerts
      WHERE organisation_id = $1
    `;

    const params = [organisationId];

    if (!resolved) {
      query += ` AND resolved_at IS NULL`;
    }

    query += ` ORDER BY triggered_at DESC`;

    try {
      const alerts = await prisma.query(query, params);
      return alerts.rows.map((a) => ({
        ...a,
        context: a.context || {},
      }));
    } catch (error) {
      console.error('Failed to fetch active alerts:', error.message);
      return [];
    }
  }

  async getAlertHistory(alertId, organisationId) {
    try {
      const history = await prisma.query(
        `
        SELECT event_type, event_at, actor_id, context
        FROM observability.alert_history
        WHERE alert_id = $1
        ORDER BY event_at ASC
        `,
        [alertId],
      );

      return history.rows.map((h) => ({
        ...h,
        context: h.context || {},
      }));
    } catch (error) {
      console.error('Failed to fetch alert history:', error.message);
      return [];
    }
  }

  async getAlertStats(organisationId, options = {}) {
    const { days = 7 } = options;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const stats = await prisma.query(
        `
        SELECT
          COUNT(*)::int as total_alerts,
          COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int as resolved_count,
          COUNT(*) FILTER (WHERE resolved_at IS NULL)::int as active_count,
          COUNT(*) FILTER (WHERE ack_at IS NOT NULL)::int as acknowledged_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - triggered_at)) / 60)::NUMERIC, 2)::float as avg_resolution_time_min
        FROM observability.active_alerts
        WHERE organisation_id = $1
          AND triggered_at >= $2
        `,
        [organisationId, startDate],
      );

      return stats.rows[0];
    } catch (error) {
      console.error('Failed to fetch alert stats:', error.message);
      return null;
    }
  }

  async disableAlertRule(ruleId, organisationId) {
    try {
      await prisma.query(
        `
        UPDATE observability.alert_rules
        SET enabled = false, updated_at = $1
        WHERE id = $2 AND organisation_id = $3
        `,
        [new Date(), ruleId, organisationId],
      );

      return true;
    } catch (error) {
      console.error('Failed to disable alert rule:', error.message);
      return false;
    }
  }

  async deleteAlertRule(ruleId, organisationId) {
    try {
      await prisma.query(
        `
        DELETE FROM observability.alert_rules
        WHERE id = $1 AND organisation_id = $2
        `,
        [ruleId, organisationId],
      );

      return true;
    } catch (error) {
      console.error('Failed to delete alert rule:', error.message);
      return false;
    }
  }
}

module.exports = new AlertingService();
