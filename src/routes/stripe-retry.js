/**
 * Routes pour les retries de paiement Stripe
 * @module routes/stripe-retry
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const stripeRetryService = require('../services/stripe-retry.service');
const db = require('../core/db');
const logger = require('../observability/logger');

/**
 * GET /api/stripe/retry-logs/:invoiceId
 * Récupère l'historique des retries pour une facture
 * @param {number} invoiceId - ID de la facture
 * @returns {Object} { history: Array }
 */
router.get('/logs/:invoiceId', requireAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const history = await stripeRetryService.getRetryHistory(invoiceId);
    res.json({ history });
  } catch (error) {
    logger.error('Error fetching retry history', { error });
    res.status(500).json({ error: 'Failed to fetch retry history' });
  }
});

/**
 * POST /api/stripe/retry-payment
 * Déclenche un retry manuel pour une facture
 * @body {number} invoiceId - ID de la facture (requis)
 * @returns {Object} { success: boolean, retryLog: Object, nextRetryAt: Date }
 */
router.post('/retry-payment', requireAuth, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { invoiceId } = req.body;
    const orgId = req.user.organisation_id;

    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId is required' });
    }

    // Vérifier que la facture appartient à l'organisation
    const invoiceResult = await db.query(
      'SELECT id, stripe_invoice_id FROM invoices WHERE id = $1 AND organisation_id = $2',
      [invoiceId, orgId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Enregistrer le retry
    const retryLog = await stripeRetryService.logRetryAttempt(
      orgId,
      invoiceId,
      invoice.stripe_invoice_id,
      'manual',
      'Manual retry triggered by user'
    );

    res.json({
      success: true,
      retryLog,
      nextRetryAt: retryLog.next_retry_at,
    });
  } catch (error) {
    logger.error('Error triggering manual retry', { error });
    res.status(500).json({ error: 'Failed to trigger retry' });
  }
});

/**
 * GET /api/stripe/retry-stats
 * Récupère les statistiques des retries
 * @returns {Object} { stats: Object }
 */
router.get('/stats', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    const stats = await stripeRetryService.getRetryStats(orgId);

    res.json({ stats });
  } catch (error) {
    logger.error('Error fetching retry stats', { error });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/stripe/retry-pending
 * Récupère les retries en attente
 * @returns {Object} { pending: Array }
 */
router.get('/pending', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    const pending = await stripeRetryService.getPendingRetries(orgId);

    res.json({ pending });
  } catch (error) {
    logger.error('Error fetching pending retries', { error });
    res.status(500).json({ error: 'Failed to fetch pending retries' });
  }
});

module.exports = router;
