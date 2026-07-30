const db = require('../../db');
const logger = require('../config/logger');

/**
 * Service pour gérer l'idempotence des webhooks Stripe.
 * 
 * Utilise une table `stripe_webhook_events` avec une contrainte UNIQUE sur `stripe_event_id`
 * pour garantir qu'un même événement Stripe ne peut être traité qu'une seule fois,
 * même s'il est reçu plusieurs fois ou par plusieurs instances du backend.
 * 
 * Statuts :
 * - processing : événement en cours de traitement
 * - processed : événement traité avec succès
 * - failed : traitement échoué, peut être retenté
 */

/**
 * Réserve un événement Stripe de manière atomique.
 * 
 * Retourne :
 * - { action: 'reserved', event: {...} } si la réservation a réussi
 * - { action: 'duplicate', status: 'processed' } si l'événement est déjà traité
 * - { action: 'duplicate', status: 'processing' } si l'événement est en cours
 * - { action: 'duplicate', status: 'failed' } si l'événement a échoué
 * 
 * @param {string} stripeEventId - L'ID unique de l'événement Stripe (evt_...)
 * @param {string} eventType - Le type d'événement (checkout.session.completed, etc.)
 * @returns {Promise<object>} Résultat de la réservation
 */
async function reserveEvent(stripeEventId, eventType) {
  if (!stripeEventId || typeof stripeEventId !== 'string') {
    throw new Error('Invalid Stripe event ID');
  }

  try {
    // Tentative d'insertion atomique avec ON CONFLICT DO NOTHING
    const result = await db.query(
      `INSERT INTO stripe_webhook_events (
        stripe_event_id,
        event_type,
        status,
        attempts,
        processing_started_at
      )
      VALUES ($1, $2, 'processing', 1, NOW())
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING *`,
      [stripeEventId, eventType]
    );

    // Si une ligne a été retournée, la réservation a réussi
    if (result.rows.length > 0) {
      logger.info('Stripe webhook event reserved', {
        stripe_event_id: stripeEventId,
        event_type: eventType,
      });
      return {
        action: 'reserved',
        event: result.rows[0],
      };
    }

    // L'événement existe déjà, récupérer son état
    const existingResult = await db.query(
      `SELECT stripe_event_id, status, attempts, processed_at, failed_at
       FROM stripe_webhook_events
       WHERE stripe_event_id = $1`,
      [stripeEventId]
    );

    if (existingResult.rows.length === 0) {
      // Cas rare : l'événement a été supprimé entre l'INSERT et le SELECT
      throw new Error('Event disappeared after conflict');
    }

    const existing = existingResult.rows[0];

    logger.info('Stripe webhook event duplicate detected', {
      stripe_event_id: stripeEventId,
      status: existing.status,
      attempts: existing.attempts,
    });

    return {
      action: 'duplicate',
      status: existing.status,
      attempts: existing.attempts,
      processedAt: existing.processed_at,
      failedAt: existing.failed_at,
    };
  } catch (err) {
    logger.error('Error reserving Stripe webhook event', {
      stripe_event_id: stripeEventId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Marque un événement comme traité avec succès.
 * 
 * @param {string} stripeEventId - L'ID unique de l'événement Stripe
 * @returns {Promise<void>}
 */
async function markProcessed(stripeEventId) {
  try {
    await db.query(
      `UPDATE stripe_webhook_events
       SET status = 'processed', processed_at = NOW(), last_error = NULL
       WHERE stripe_event_id = $1`,
      [stripeEventId]
    );

    logger.info('Stripe webhook event marked as processed', {
      stripe_event_id: stripeEventId,
    });
  } catch (err) {
    logger.error('Error marking Stripe webhook event as processed', {
      stripe_event_id: stripeEventId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Marque un événement comme échoué.
 * 
 * @param {string} stripeEventId - L'ID unique de l'événement Stripe
 * @param {Error|string} error - L'erreur qui s'est produite
 * @returns {Promise<void>}
 */
async function markFailed(stripeEventId, error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  // Limiter la taille du message d'erreur stocké
  const truncatedError = errorMessage.substring(0, 500);

  try {
    await db.query(
      `UPDATE stripe_webhook_events
       SET status = 'failed', failed_at = NOW(), last_error = $2
       WHERE stripe_event_id = $1`,
      [stripeEventId, truncatedError]
    );

    logger.warn('Stripe webhook event marked as failed', {
      stripe_event_id: stripeEventId,
      error: truncatedError,
    });
  } catch (err) {
    logger.error('Error marking Stripe webhook event as failed', {
      stripe_event_id: stripeEventId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Reprend le traitement d'un événement qui a échoué.
 * 
 * Retourne :
 * - { action: 'retry', event: {...} } si la reprise a réussi
 * - { action: 'not_failed' } si l'événement n'est pas en état 'failed'
 * 
 * @param {string} stripeEventId - L'ID unique de l'événement Stripe
 * @returns {Promise<object>} Résultat de la reprise
 */
async function retryFailedEvent(stripeEventId) {
  try {
    const result = await db.query(
      `UPDATE stripe_webhook_events
       SET status = 'processing',
           attempts = attempts + 1,
           processing_started_at = NOW(),
           failed_at = NULL,
           last_error = NULL
       WHERE stripe_event_id = $1 AND status = 'failed'
       RETURNING *`,
      [stripeEventId]
    );

    if (result.rows.length === 0) {
      logger.info('Stripe webhook event not in failed state, cannot retry', {
        stripe_event_id: stripeEventId,
      });
      return { action: 'not_failed' };
    }

    logger.info('Stripe webhook event retry initiated', {
      stripe_event_id: stripeEventId,
      attempts: result.rows[0].attempts,
    });

    return {
      action: 'retry',
      event: result.rows[0],
    };
  } catch (err) {
    logger.error('Error retrying Stripe webhook event', {
      stripe_event_id: stripeEventId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Récupère l'état actuel d'un événement.
 * 
 * @param {string} stripeEventId - L'ID unique de l'événement Stripe
 * @returns {Promise<object|null>} L'événement ou null s'il n'existe pas
 */
async function getEventState(stripeEventId) {
  try {
    const result = await db.query(
      `SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1`,
      [stripeEventId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    logger.error('Error getting Stripe webhook event state', {
      stripe_event_id: stripeEventId,
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  reserveEvent,
  markProcessed,
  markFailed,
  retryFailedEvent,
  getEventState,
};
