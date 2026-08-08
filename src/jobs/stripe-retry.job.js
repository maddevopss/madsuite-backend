/**
 * Job pour exécuter les retries de paiement Stripe
 * @module jobs/stripe-retry
 */

const logger = require('../observability/logger');
const stripeRetryService = require('../services/stripe-retry.service');
const db = require('../core/db');

/**
 * Exécute les retries de paiement en attente
 * Doit être appelé toutes les heures via un scheduler
 * @returns {Promise<Object>} Résumé de l'exécution
 * @throws {Error} Si une erreur critique se produit
 */
async function executeStripeRetries() {
  const startTime = Date.now();
  const summary = {
    totalRetries: 0,
    successfulRetries: 0,
    failedRetries: 0,
    errors: [],
  };

  try {
    logger.info('Starting Stripe retry job');

    // Récupérer toutes les organisations
    const orgsResult = await db.query('SELECT id FROM organisations');
    const organisations = orgsResult.rows;

    logger.info(`Processing ${organisations.length} organisations`);

    for (const org of organisations) {
      try {
        // Récupérer les retries en attente pour cette organisation
        const pendingRetries = await stripeRetryService.getPendingRetries(org.id);

        if (pendingRetries.length > 0) {
          logger.info(`Found ${pendingRetries.length} pending retries for org ${org.id}`);
        }

        for (const retry of pendingRetries) {
          try {
            summary.totalRetries += 1;

            await stripeRetryService.executeRetry(retry.id, retry.stripe_invoice_id);
            summary.successfulRetries += 1;

            logger.info('Retry executed successfully', {
              retryId: retry.id,
              invoiceId: retry.invoice_id,
            });
          } catch (error) {
            summary.failedRetries += 1;
            summary.errors.push({
              retryId: retry.id,
              error: error.message,
            });

            logger.error('Error executing retry', {
              retryId: retry.id,
              invoiceId: retry.invoice_id,
              error,
            });
            // Continuer avec le prochain retry
          }
        }
      } catch (error) {
        summary.errors.push({
          orgId: org.id,
          error: error.message,
        });

        logger.error('Error processing retries for org', {
          orgId: org.id,
          error,
        });
        // Continuer avec la prochaine organisation
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Stripe retry job completed', {
      ...summary,
      duration: `${duration}ms`,
    });

    return summary;
  } catch (error) {
    logger.error('Critical error in Stripe retry job', { error });
    throw error;
  }
}

module.exports = {
  executeStripeRetries,
};
