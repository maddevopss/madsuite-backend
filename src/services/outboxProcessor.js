/**
 * Outbox Event Processor
 *
 * Processes deferred events from outbox_events table using:
 * - Retry engine (PR C) for exponential backoff and quarantine
 * - Job registry (PR B) for configuration
 * - Event handlers (PR D) for pluggable delivery
 *
 * Flow:
 * 1. Fetch pending events respecting retry schedule
 * 2. Execute event handler
 * 3. Record attempt to retry_attempts
 * 4. On permanent error or max retries: quarantine to quarantine_queue
 * 5. Support manual recovery with payload override
 */

const db = require("../../db");
const logger = require("../config/logger");
const eventHandlers = require("../config/eventHandlers");
const retryEngine = require("./retryEngine");
const { getJob, updateJobStatus } = require("../config/jobRegistry");

/**
 * Process pending outbox events
 * Called by outboxWorkerTask job
 */
async function processOutboxEvents(maxEvents = 50) {
  const startTime = Date.now();
  const stats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    quarantined: 0,
    errors: []
  };

  try {
    // Mark job as started
    await updateJobStatus("outboxWorkerTask", "STARTED");

    // Recover stuck events (processing state too long)
    await recoverStuckEvents();

    // Fetch pending events
    const events = await fetchPendingOutboxEvents(maxEvents);

    if (events.length === 0) {
      await updateJobStatus("outboxWorkerTask", "SUCCESS");
      return stats;
    }

    logger.info(`Processing ${events.length} pending outbox events`);

    for (const event of events) {
      stats.processed++;

      try {
        await processOutboxEvent(event);
        stats.succeeded++;
      } catch (error) {
        stats.failed++;
        stats.errors.push({
          eventId: event.id,
          error: error.message
        });
        logger.error(`Failed to process outbox event ${event.id}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    await updateJobStatus("outboxWorkerTask", "SUCCESS", {
      duration,
      ...stats
    });

    return stats;
  } catch (error) {
    logger.error("Error in processOutboxEvents:", error);
    await updateJobStatus("outboxWorkerTask", "FAILED", {
      errorMessage: error.message
    });
    throw error;
  }
}

/**
 * Process single outbox event with retry/quarantine
 */
async function processOutboxEvent(event) {
  const {
    id: eventId,
    event_type,
    event_handler_name,
    payload,
    retry_policy_name,
    delivery_attempts
  } = event;

  const startTime = Date.now();

  try {
    // Mark as processing
    await markEventProcessing(eventId);

    // Get handler
    const handler = await eventHandlers.getEventHandler(event_handler_name || event_type);
    if (!handler) {
      throw new Error(`Unknown event handler: ${event_handler_name || event_type}`);
    }

    // Get retry policy
    const policy = await retryEngine.getRetryPolicy(retry_policy_name || "moderate");
    if (!policy) {
      throw new Error(`Unknown retry policy: ${retry_policy_name}`);
    }

    // Execute delivery
    const result = await eventHandlers.executeEventHandler(
      event_handler_name || event_type,
      payload,
      { eventId, attempt: delivery_attempts + 1 }
    );

    const duration = Date.now() - startTime;

    if (result.success) {
      // Mark as completed
      await markEventCompleted(eventId, duration);
      await eventHandlers.recordDeliveryAttempt(
        event_handler_name || event_type,
        true,
        duration
      );
      return;
    }

    // Handle failure with retry/quarantine decision
    await handleEventFailure(
      eventId,
      event_type,
      event_handler_name || event_type,
      payload,
      result.error,
      result.errorCode,
      delivery_attempts + 1,
      policy,
      duration
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(`Error processing outbox event ${eventId}:`, error);

    // Record failure
    await recordEventFailure(
      eventId,
      error.message,
      delivery_attempts + 1
    );

    // Try to handle with retry/quarantine
    try {
      const policy = await retryEngine.getRetryPolicy(retry_policy_name || "moderate");
      if (policy) {
        await handleEventFailure(
          eventId,
          event_type,
          event_handler_name || event_type,
          payload,
          error.message,
          "HANDLER_ERROR",
          delivery_attempts + 1,
          policy,
          duration
        );
      }
    } catch (err) {
      logger.error(`Failed to handle event failure for ${eventId}:`, err);
    }

    throw error;
  }
}

/**
 * Handle event delivery failure - decide between retry and quarantine
 */
async function handleEventFailure(
  eventId,
  eventType,
  handlerName,
  payload,
  errorMessage,
  errorCode,
  attemptNumber,
  retryPolicy,
  durationMs
) {
  try {
    // Use retry engine decision logic
    const decision = await retryEngine.handleRetryOrQuarantine(
      "outbox_event",
      eventId,
      {
        attemptNumber,
        maxAttempts: retryPolicy.max_attempts,
        error: new Error(errorMessage),
        errorCode,
        errorMessage,
        payload: { eventType, handlerName, payload },
        retryPolicy,
        metadata: {
          eventType,
          handlerName,
          attemptNumber
        },
        tags: [eventType, handlerName]
      }
    );

    if (decision.action === "retry") {
      // Update event for retry
      await db.pool.query(`
        UPDATE outbox_events
        SET
          delivery_attempts = $2,
          last_delivery_error = $3,
          status = 'pending',
          next_retry_at = CURRENT_TIMESTAMP + INTERVAL '1 minute' * $4
        WHERE id = $1
      `, [eventId, attemptNumber, errorMessage, Math.min(5, attemptNumber)]);

      await eventHandlers.recordDeliveryAttempt(
        handlerName,
        false,
        durationMs,
        errorMessage
      );
    } else if (decision.action === "quarantine") {
      // Quarantine event
      const qItem = await retryEngine.quarantineWork("outbox_event", eventId, {
        reason: decision.reason,
        errorCode,
        errorMessage,
        payload: { eventType, handlerName, payload },
        tags: [eventType, handlerName]
      });

      // Link quarantine to outbox event
      await db.pool.query(`
        UPDATE outbox_events
        SET
          status = 'quarantined',
          quarantine_id = $2,
          delivery_attempts = $3,
          last_delivery_error = $4
        WHERE id = $1
      `, [eventId, qItem.id, attemptNumber, errorMessage]);

      logger.warn(`Event ${eventId} quarantined: ${decision.reason}`);

      await eventHandlers.recordDeliveryAttempt(
        handlerName,
        false,
        durationMs,
        errorMessage
      );
    }
  } catch (error) {
    logger.error(`Error handling event failure for ${eventId}:`, error);
    throw error;
  }
}

/**
 * Recover events stuck in 'processing' state for too long
 */
async function recoverStuckEvents(timeoutSeconds = 600) {
  try {
    const result = await db.pool.query(`
      UPDATE outbox_events
      SET status = 'pending'
      WHERE status = 'processing'
        AND delivery_started_at < CURRENT_TIMESTAMP - INTERVAL '1 second' * $1
      RETURNING id
    `, [timeoutSeconds]);

    if (result.rows.length > 0) {
      logger.warn(`Recovered ${result.rows.length} stuck outbox events`);
    }

    return result.rows;
  } catch (error) {
    logger.error("Error recovering stuck events:", error);
    return [];
  }
}

/**
 * Fetch pending outbox events respecting retry schedule
 */
async function fetchPendingOutboxEvents(limit = 50) {
  try {
    const result = await db.pool.query(`
      SELECT
        id,
        event_type,
        event_handler_name,
        payload,
        retry_policy_name,
        delivery_attempts,
        next_retry_at
      FROM outbox_events
      WHERE status = 'pending'
        AND next_retry_at <= CURRENT_TIMESTAMP
      ORDER BY next_retry_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [limit]);

    return result.rows;
  } catch (error) {
    logger.error("Error fetching pending outbox events:", error);
    return [];
  }
}

/**
 * Mark event as processing
 */
async function markEventProcessing(eventId) {
  try {
    await db.pool.query(`
      UPDATE outbox_events
      SET
        status = 'processing',
        delivery_started_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [eventId]);
  } catch (error) {
    logger.error(`Error marking event ${eventId} as processing:`, error);
    throw error;
  }
}

/**
 * Mark event as completed
 */
async function markEventCompleted(eventId, durationMs = null) {
  try {
    await db.pool.query(`
      UPDATE outbox_events
      SET
        status = 'completed',
        processed_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [eventId]);

    logger.info(`Event ${eventId} completed in ${durationMs}ms`);
  } catch (error) {
    logger.error(`Error marking event ${eventId} as completed:`, error);
    throw error;
  }
}

/**
 * Record event failure
 */
async function recordEventFailure(eventId, errorMessage, attemptNumber) {
  try {
    await db.pool.query(`
      UPDATE outbox_events
      SET
        status = 'pending',
        delivery_attempts = $2,
        last_delivery_error = $3
      WHERE id = $1
    `, [eventId, attemptNumber, errorMessage]);
  } catch (error) {
    logger.error(`Error recording failure for event ${eventId}:`, error);
  }
}

/**
 * Get event by ID
 */
async function getEvent(eventId) {
  try {
    const result = await db.pool.query(`
      SELECT * FROM outbox_events WHERE id = $1
    `, [eventId]);

    return result.rows[0] || null;
  } catch (error) {
    logger.error(`Error getting event ${eventId}:`, error);
    return null;
  }
}

/**
 * Get quarantined events
 */
async function getQuarantinedEvents(filters = {}) {
  try {
    const result = await db.pool.query(`
      SELECT
        oe.id,
        oe.event_type,
        oe.event_handler_name,
        oe.payload,
        oe.delivery_attempts,
        oe.last_delivery_error,
        oe.created_at,
        qq.id as quarantine_id,
        qq.reason,
        qq.recovery_status,
        qq.recovery_attempts
      FROM outbox_events oe
      JOIN quarantine_queue qq ON oe.quarantine_id = qq.id
      WHERE oe.status = 'quarantined'
      ORDER BY oe.created_at DESC
      LIMIT $1
    `, [filters.limit || 100]);

    return result.rows;
  } catch (error) {
    logger.error("Error getting quarantined events:", error);
    return [];
  }
}

/**
 * Retry quarantined event from recovery
 */
async function retryQuarantinedEvent(eventId, recoveryId, payloadOverride = null) {
  try {
    const event = await getEvent(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    // Process with overridden payload if provided
    const payload = payloadOverride || event.payload;

    const result = await db.pool.query(`
      UPDATE outbox_events
      SET
        status = 'pending',
        payload = $2,
        recovery_id = $3,
        next_retry_at = CURRENT_TIMESTAMP,
        delivery_attempts = 0
      WHERE id = $1
      RETURNING *
    `, [eventId, JSON.stringify(payload), recoveryId]);

    if (result.rows.length > 0) {
      logger.info(`Scheduled retry for quarantined event ${eventId}`);
      return result.rows[0];
    }

    return null;
  } catch (error) {
    logger.error(`Error retrying quarantined event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Get outbox statistics
 */
async function getOutboxStats(handlerName = null, daysBack = 7) {
  try {
    let query = `
      SELECT
        event_handler_name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'quarantined') as quarantined,
        AVG(EXTRACT(EPOCH FROM (processed_at - created_at))::NUMERIC) as avg_duration_sec
      FROM outbox_events
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day' * $1
    `;

    const params = [daysBack];
    let paramCount = 2;

    if (handlerName) {
      query += ` AND event_handler_name = $${paramCount}`;
      params.push(handlerName);
      paramCount++;
    }

    query += ` GROUP BY event_handler_name ORDER BY total DESC`;

    const result = await db.pool.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error("Error getting outbox stats:", error);
    return [];
  }
}

module.exports = {
  processOutboxEvents,
  processOutboxEvent,
  handleEventFailure,
  recoverStuckEvents,
  fetchPendingOutboxEvents,
  markEventProcessing,
  markEventCompleted,
  recordEventFailure,
  getEvent,
  getQuarantinedEvents,
  retryQuarantinedEvent,
  getOutboxStats
};
