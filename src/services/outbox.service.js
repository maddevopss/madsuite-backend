const { pool } = require("../../db");
const logger = require("../config/logger");

/**
 * Inserts an event into the outbox.
 * MUST be called within an existing database transaction, passing the `client` object.
 *
 * @param {object} client - The pg client from pool.connect() participating in a transaction.
 * @param {string} eventType - Type of the event (e.g., 'dunning_reminder', 'recurring_invoice_reminder').
 * @param {object} payload - The JSON payload needed to process the event.
 */
async function insertEvent(client, eventType, payload) {
  if (!client) {
    throw new Error("A database client within a transaction must be provided to insertEvent.");
  }
  
  const query = `
    INSERT INTO outbox_events (event_type, payload, status)
    VALUES ($1, $2, 'pending')
    RETURNING id
  `;
  
  const res = await client.query(query, [eventType, payload]);
  logger.info(`Outbox event created: ${eventType} (ID: ${res.rows[0].id})`);
  return res.rows[0].id;
}

/**
 * Fetches pending events for the worker to process.
 * Uses FOR UPDATE SKIP LOCKED to prevent concurrent workers from picking the same events.
 * 
 * @param {number} limit - Maximum number of events to fetch.
 */
async function fetchPendingEvents(limit = 50) {
  const query = `
    SELECT id, event_type, payload, retry_count
    FROM outbox_events
    WHERE status = 'pending' AND next_retry_at <= CURRENT_TIMESTAMP
    ORDER BY next_retry_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  `;
  const { rows } = await pool.query(query, [limit]);
  return rows;
}

/**
 * Marks an event as processing.
 */
async function markEventProcessing(id) {
  await pool.query(`
    UPDATE outbox_events
    SET status = 'processing'
    WHERE id = $1
  `, [id]);
}

/**
 * Marks an event as completed.
 */
async function markEventCompleted(id) {
  await pool.query(`
    UPDATE outbox_events
    SET status = 'completed', processed_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [id]);
}

/**
 * Marks an event as failed and increments its retry count.
 * If max retries reached, stays 'failed'. Otherwise, resets to 'pending' for retry.
 */
async function markEventFailed(id, errorMessage, maxRetries = 3) {
  const query = `
    UPDATE outbox_events
    SET 
      retry_count = retry_count + 1,
      status = CASE 
        WHEN retry_count + 1 >= $3 THEN 'failed'
        ELSE 'pending'
      END,
      next_retry_at = CASE 
        WHEN retry_count + 1 = 1 THEN CURRENT_TIMESTAMP + INTERVAL '1 minute'
        WHEN retry_count + 1 = 2 THEN CURRENT_TIMESTAMP + INTERVAL '5 minutes'
        ELSE CURRENT_TIMESTAMP + INTERVAL '30 minutes'
      END,
      last_error = $2,
      processed_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING status, retry_count
  `;
  
  const { rows } = await pool.query(query, [id, errorMessage, maxRetries]);
  return rows[0];
}

/**
 * Recovers events that have been stuck in 'processing' status for too long.
 * Protects against silent failures if the server crashes after picking an event but before finishing.
 */
async function recoverStuckEvents() {
  await pool.query(`
    UPDATE outbox_events
    SET status = 'pending',
        retry_count = retry_count + 1,
        last_error = 'Process crashed during execution',
        next_retry_at = CURRENT_TIMESTAMP
    WHERE status = 'processing'
      AND processed_at < NOW() - INTERVAL '15 minutes'
  `);
}

module.exports = {
  insertEvent,
  fetchPendingEvents,
  markEventProcessing,
  markEventCompleted,
  markEventFailed,
  recoverStuckEvents
};
