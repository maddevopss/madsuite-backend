/**
 * Service pour gérer les retries de paiement Stripe
 * @module services/stripe-retry
 */

const db = require('../core/db');
const logger = require('../observability/logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Configuration des retries
const RETRY_CONFIG = {
  max_attempts: 3,
  delays: [
    24 * 60 * 60 * 1000, // 1 jour
    3 * 24 * 60 * 60 * 1000, // 3 jours
    5 * 24 * 60 * 60 * 1000, // 5 jours
  ],
};

/**
 * Enregistre une tentative de retry échouée
 * @param {number} orgId - ID de l'organisation
 * @param {number} invoiceId - ID de la facture
 * @param {string} stripeInvoiceId - ID Stripe de la facture
 * @param {string} errorCode - Code d'erreur
 * @param {string} errorMessage - Message d'erreur
 * @returns {Promise<Object>} Log de retry créé
 * @throws {Error} Si la requête échoue
 */
async function logRetryAttempt(orgId, invoiceId, stripeInvoiceId, errorCode, errorMessage) {
  try {
    // Récupérer le nombre de tentatives précédentes
    const previousAttempts = await db.query(
      `SELECT COUNT(*) as count FROM stripe_retry_logs
       WHERE invoice_id = $1 AND status IN ('retrying', 'failed')`,
      [invoiceId]
    );

    const attemptNumber = (previousAttempts.rows[0]?.count || 0) + 1;

    // Calculer la date du prochain retry
    let nextRetryAt = null;
    if (attemptNumber < RETRY_CONFIG.max_attempts) {
      const delayMs = RETRY_CONFIG.delays[attemptNumber - 1];
      nextRetryAt = new Date(Date.now() + delayMs);
    }

    const result = await db.query(
      `INSERT INTO stripe_retry_logs 
       (organisation_id, invoice_id, stripe_invoice_id, attempt_number, error_code, error_message, next_retry_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [orgId, invoiceId, stripeInvoiceId, attemptNumber, errorCode, errorMessage, nextRetryAt]
    );

    logger.info('Retry attempt logged', {
      invoiceId,
      attemptNumber,
      nextRetryAt,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error logging retry attempt', { invoiceId, error });
    throw error;
  }
}

/**
 * Récupère les retries en attente
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<Array>} Liste des retries en attente
 * @throws {Error} Si la requête échoue
 */
async function getPendingRetries(orgId) {
  try {
    const result = await db.query(
      `SELECT srl.*, i.stripe_invoice_id, i.amount, i.currency
       FROM stripe_retry_logs srl
       JOIN invoices i ON srl.invoice_id = i.id
       WHERE srl.organisation_id = $1
       AND srl.status = 'pending'
       AND srl.next_retry_at <= NOW()
       ORDER BY srl.next_retry_at ASC`,
      [orgId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error fetching pending retries', { orgId, error });
    throw error;
  }
}

/**
 * Exécute un retry de paiement
 * @param {number} retryLogId - ID du log de retry
 * @param {string} stripeInvoiceId - ID Stripe de la facture
 * @returns {Promise<Object>} Résultat du retry
 * @throws {Error} Si la requête échoue
 */
async function executeRetry(retryLogId, stripeInvoiceId) {
  try {
    // Récupérer la facture Stripe
    const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId);

    // Tenter de relancer le paiement
    const result = await stripe.invoices.sendInvoice(stripeInvoiceId);

    // Mettre à jour le log
    await db.query(
      `UPDATE stripe_retry_logs
       SET status = 'retrying', last_attempted_at = NOW()
       WHERE id = $1`,
      [retryLogId]
    );

    logger.info('Retry executed successfully', { retryLogId, stripeInvoiceId });
    return { success: true, result };
  } catch (error) {
    logger.error('Error executing retry', { retryLogId, error });

    // Mettre à jour le log avec l'erreur
    await db.query(
      `UPDATE stripe_retry_logs
       SET status = 'failed', error_code = $1, error_message = $2, last_attempted_at = NOW()
       WHERE id = $3`,
      [error.code, error.message, retryLogId]
    );

    throw error;
  }
}

/**
 * Marque un retry comme réussi
 * @param {number} retryLogId - ID du log de retry
 * @returns {Promise<boolean>} Succès
 * @throws {Error} Si la requête échoue
 */
async function markRetrySuccess(retryLogId) {
  try {
    await db.query(
      `UPDATE stripe_retry_logs
       SET status = 'success', updated_at = NOW()
       WHERE id = $1`,
      [retryLogId]
    );

    logger.info('Retry marked as success', { retryLogId });
    return true;
  } catch (error) {
    logger.error('Error marking retry as success', { retryLogId, error });
    throw error;
  }
}

/**
 * Récupère l'historique des retries pour une facture
 * @param {number} invoiceId - ID de la facture
 * @returns {Promise<Array>} Historique des retries
 * @throws {Error} Si la requête échoue
 */
async function getRetryHistory(invoiceId) {
  try {
    const result = await db.query(
      `SELECT id, attempt_number, error_code, error_message, status, last_attempted_at, created_at
       FROM stripe_retry_logs
       WHERE invoice_id = $1
       ORDER BY created_at DESC`,
      [invoiceId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error fetching retry history', { invoiceId, error });
    throw error;
  }
}

/**
 * Récupère les statistiques des retries
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<Object>} Statistiques des retries
 * @throws {Error} Si la requête échoue
 */
async function getRetryStats(orgId) {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_retries,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_retries,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_retries,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_retries
       FROM stripe_retry_logs
       WHERE organisation_id = $1`,
      [orgId]
    );

    return result.rows[0] || {
      total_retries: 0,
      successful_retries: 0,
      failed_retries: 0,
      pending_retries: 0,
    };
  } catch (error) {
    logger.error('Error fetching retry stats', { orgId, error });
    throw error;
  }
}

module.exports = {
  logRetryAttempt,
  getPendingRetries,
  executeRetry,
  markRetrySuccess,
  getRetryHistory,
  getRetryStats,
  RETRY_CONFIG,
};
