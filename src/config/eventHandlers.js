/**
 * Event Handlers Registry
 *
 * Centralized registry for all event handlers used by the outbox processor.
 * Each handler is responsible for:
 * - Validating event payload
 * - Executing delivery
 * - Returning success/error with classification
 */

const db = require("../../db");
const logger = require("./logger");

/**
 * Event handler interface:
 * {
 *   name: string,
 *   description: string,
 *   execute: async (payload, metadata) => {success: bool, error?: string, errorCode?: string}
 * }
 */

// Built-in handlers
const BUILT_IN_HANDLERS = {};

/**
 * Email reminder handler
 */
BUILT_IN_HANDLERS.email_reminder = {
  name: "email_reminder",
  description: "Send reminder emails",
  async execute(payload, metadata = {}) {
    try {
      const { email, type, data } = payload;

      if (!email || !type) {
        return {
          success: false,
          error: "Missing email or type in payload",
          errorCode: "INVALID_PAYLOAD"
        };
      }

      // TODO: Integrate with email service
      logger.info(`Would send ${type} email to ${email}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code || "EMAIL_SERVICE_ERROR"
      };
    }
  }
};

/**
 * Webhook delivery handler
 */
BUILT_IN_HANDLERS.webhook_delivery = {
  name: "webhook_delivery",
  description: "Deliver events to webhook endpoints",
  async execute(payload, metadata = {}) {
    try {
      const { url, event, signature } = payload;

      if (!url || !event) {
        return {
          success: false,
          error: "Missing url or event in payload",
          errorCode: "INVALID_PAYLOAD"
        };
      }

      // TODO: Integrate with HTTP client
      logger.info(`Would POST webhook to ${url}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code || "WEBHOOK_DELIVERY_ERROR"
      };
    }
  }
};

/**
 * SMS notification handler
 */
BUILT_IN_HANDLERS.sms_notification = {
  name: "sms_notification",
  description: "Send SMS notifications",
  async execute(payload, metadata = {}) {
    try {
      const { phone, message } = payload;

      if (!phone || !message) {
        return {
          success: false,
          error: "Missing phone or message in payload",
          errorCode: "INVALID_PAYLOAD"
        };
      }

      // TODO: Integrate with SMS service
      logger.info(`Would send SMS to ${phone}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code || "SMS_SERVICE_ERROR"
      };
    }
  }
};

/**
 * API call handler
 */
BUILT_IN_HANDLERS.api_call = {
  name: "api_call",
  description: "Make outbound API calls",
  async execute(payload, metadata = {}) {
    try {
      const { endpoint, method, data } = payload;

      if (!endpoint) {
        return {
          success: false,
          error: "Missing endpoint in payload",
          errorCode: "INVALID_PAYLOAD"
        };
      }

      // TODO: Integrate with HTTP client
      logger.info(`Would call ${method || 'POST'} ${endpoint}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code || "API_CALL_ERROR"
      };
    }
  }
};

/**
 * Payment processing handler
 */
BUILT_IN_HANDLERS.payment_processing = {
  name: "payment_processing",
  description: "Process payment transactions",
  async execute(payload, metadata = {}) {
    try {
      const { transactionId, amount, currency } = payload;

      if (!transactionId || !amount) {
        return {
          success: false,
          error: "Missing transactionId or amount in payload",
          errorCode: "INVALID_PAYLOAD"
        };
      }

      // TODO: Integrate with payment service
      logger.info(`Would process payment ${transactionId} for ${amount} ${currency || 'USD'}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code || "PAYMENT_ERROR"
      };
    }
  }
};

/**
 * Get event handler by name
 */
async function getEventHandler(handlerName) {
  try {
    // Check database for custom/configured handler
    const result = await db.pool.query(
      `SELECT * FROM event_handlers WHERE handler_name = $1`,
      [handlerName]
    );

    const config = result.rows[0];

    // Return handler with database config merged
    if (BUILT_IN_HANDLERS[handlerName]) {
      return {
        ...BUILT_IN_HANDLERS[handlerName],
        config
      };
    }

    return config || null;
  } catch (error) {
    logger.error(`Error getting event handler ${handlerName}:`, error);
    return null;
  }
}

/**
 * Get all event handlers
 */
async function getAllEventHandlers(filters = {}) {
  try {
    let query = `SELECT * FROM event_handlers WHERE 1=1`;
    const params = [];
    let paramCount = 1;

    if (filters.enabled !== undefined) {
      query += ` AND enabled = $${paramCount}`;
      params.push(filters.enabled);
      paramCount++;
    }

    if (filters.tag) {
      query += ` AND $${paramCount} = ANY(tags)`;
      params.push(filters.tag);
      paramCount++;
    }

    query += ` ORDER BY handler_name`;

    const result = await db.pool.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error("Error getting event handlers:", error);
    return [];
  }
}

/**
 * Register event handler in database
 */
async function registerEventHandler(handlerName, config) {
  try {
    const {
      displayName,
      description,
      timeoutSeconds = 30,
      maxAttempts = 3,
      retryPolicyName = "moderate",
      enabled = true,
      notifyOnFailure = true,
      ownerTeam = null,
      ownerEmail = null,
      ownerSlackChannel = null,
      tags = [],
      configuration = null
    } = config;

    const result = await db.pool.query(`
      INSERT INTO event_handlers (
        handler_name,
        display_name,
        description,
        timeout_seconds,
        max_attempts,
        retry_policy_name,
        enabled,
        notify_on_failure,
        owner_team,
        owner_email,
        owner_slack_channel,
        tags,
        configuration
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (handler_name) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        timeout_seconds = EXCLUDED.timeout_seconds,
        max_attempts = EXCLUDED.max_attempts,
        retry_policy_name = EXCLUDED.retry_policy_name,
        enabled = EXCLUDED.enabled,
        notify_on_failure = EXCLUDED.notify_on_failure,
        owner_team = EXCLUDED.owner_team,
        owner_email = EXCLUDED.owner_email,
        owner_slack_channel = EXCLUDED.owner_slack_channel,
        tags = EXCLUDED.tags,
        configuration = EXCLUDED.configuration,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      handlerName,
      displayName || handlerName,
      description,
      timeoutSeconds,
      maxAttempts,
      retryPolicyName,
      enabled,
      notifyOnFailure,
      ownerTeam,
      ownerEmail,
      ownerSlackChannel,
      tags,
      configuration ? JSON.stringify(configuration) : null
    ]);

    logger.info(`Registered event handler: ${handlerName}`);
    return result.rows[0];
  } catch (error) {
    logger.error(`Error registering event handler ${handlerName}:`, error);
    throw error;
  }
}

/**
 * Execute event handler
 */
async function executeEventHandler(handlerName, payload, metadata = {}) {
  try {
    const handler = BUILT_IN_HANDLERS[handlerName];

    if (!handler) {
      return {
        success: false,
        error: `Unknown event handler: ${handlerName}`,
        errorCode: "HANDLER_NOT_FOUND"
      };
    }

    // Execute handler
    const result = await handler.execute(payload, metadata);

    return result;
  } catch (error) {
    logger.error(`Error executing event handler ${handlerName}:`, error);
    return {
      success: false,
      error: error.message,
      errorCode: "HANDLER_EXECUTION_ERROR"
    };
  }
}

/**
 * Get handler statistics
 */
async function getHandlerStats(handlerName, daysBack = 7) {
  try {
    const result = await db.pool.query(`
      SELECT
        handler_name,
        SUM(total_events) as total_events,
        SUM(successfully_delivered) as successfully_delivered,
        SUM(failed_permanently) as failed_permanently,
        SUM(quarantined) as quarantined,
        SUM(recovered) as recovered,
        AVG(avg_delivery_time_ms) as avg_delivery_time_ms,
        MAX(max_delivery_time_ms) as max_delivery_time_ms
      FROM outbox_delivery_stats
      WHERE handler_name = $1
        AND date >= CURRENT_DATE - INTERVAL '1 day' * $2
      GROUP BY handler_name
    `, [handlerName, daysBack]);

    return result.rows[0] || null;
  } catch (error) {
    logger.error(`Error getting handler stats for ${handlerName}:`, error);
    return null;
  }
}

/**
 * Record handler delivery attempt (called by outbox processor)
 */
async function recordDeliveryAttempt(handlerName, success, durationMs = null, error = null, errorCode = null) {
  try {
    // Update or insert daily stats
    const today = new Date().toISOString().split('T')[0];

    const query = `
      INSERT INTO outbox_delivery_stats (
        event_handler_name,
        date,
        total_events,
        successfully_delivered,
        failed_permanently,
        avg_delivery_time_ms,
        max_delivery_time_ms,
        most_common_error
      )
      VALUES ($1, $2, 1, $3, $4, $5, $5, $6)
      ON CONFLICT (event_handler_name, date) DO UPDATE SET
        total_events = outbox_delivery_stats.total_events + 1,
        successfully_delivered = outbox_delivery_stats.successfully_delivered + CASE WHEN $3 = 1 THEN 1 ELSE 0 END,
        failed_permanently = outbox_delivery_stats.failed_permanently + CASE WHEN $4 = 1 THEN 1 ELSE 0 END,
        avg_delivery_time_ms = CASE
          WHEN $5 IS NOT NULL THEN (outbox_delivery_stats.avg_delivery_time_ms * outbox_delivery_stats.total_events + $5) / (outbox_delivery_stats.total_events + 1)
          ELSE outbox_delivery_stats.avg_delivery_time_ms
        END,
        max_delivery_time_ms = CASE WHEN $5 IS NOT NULL THEN GREATEST(outbox_delivery_stats.max_delivery_time_ms, $5) ELSE outbox_delivery_stats.max_delivery_time_ms END,
        most_common_error = COALESCE($6, outbox_delivery_stats.most_common_error),
        updated_at = CURRENT_TIMESTAMP
    `;

    await db.pool.query(query, [
      handlerName,
      today,
      success ? 1 : 0,
      !success ? 1 : 0,
      durationMs,
      error
    ]);
  } catch (error) {
    logger.error(`Error recording delivery attempt for ${handlerName}:`, error);
  }
}

module.exports = {
  getEventHandler,
  getAllEventHandlers,
  registerEventHandler,
  executeEventHandler,
  getHandlerStats,
  recordDeliveryAttempt,
  BUILT_IN_HANDLERS
};
