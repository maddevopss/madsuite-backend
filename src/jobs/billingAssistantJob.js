const { pool } = require("../../db");
const outboxService = require("../services/outbox.service");
const paymentReminderDelivery = require("../services/payment-reminder-delivery.service");
const logger = require("../config/logger");
const { createJobResultTracker } = require("./jobResultAggregator");

async function processReminders() {
  const tracker = createJobResultTracker("Billing Assistant");
  logger.info("Démarrage du Billing Assistant Job (Relances automatiques)...");

  try {
    const automaticSummary = await paymentReminderDelivery.queueAutomaticReminders({
      baseUrl: process.env.FRONTEND_URL || "",
    });

    for (let index = 0; index < automaticSummary.queued; index += 1) {
      tracker.recordSuccess();
    }
    for (let index = 0; index < automaticSummary.failed; index += 1) {
      await tracker.recordFailure(new Error("Échec de mise en file d’une relance automatique."));
    }

    logger.info("Relances automatiques de factures évaluées.", automaticSummary);
  } catch (error) {
    logger.error("Erreur globale des relances automatiques de factures:", error);
    await tracker.recordFailure(error);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Les relances de soumissions conservent leur parcours historique.
    const pendingEstimatesQuery = `
      SELECT e.*, c.email as client_email
      FROM estimates e
      JOIN clients c ON e.client_id = c.id
      WHERE e.status = 'sent'
        AND e.valid_until < CURRENT_DATE
        AND e.reminders_sent < 3
        AND (e.last_reminder_at IS NULL OR e.last_reminder_at < NOW() - INTERVAL '3 days')
        AND e.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED
    `;
    const pendingEstimates = await client.query(pendingEstimatesQuery);

    for (const estimate of pendingEstimates.rows) {
      if (!estimate.client_email) continue;

      try {
        await outboxService.insertEvent(client, "estimate_reminder", {
          email: estimate.client_email,
          estimate,
        });

        await client.query(
          `UPDATE estimates
           SET reminders_sent = reminders_sent + 1, last_reminder_at = NOW()
           WHERE id = $1`,
          [estimate.id],
        );

        logger.info(`Relance envoyée pour la soumission ${estimate.estimate_number}`);
        tracker.recordSuccess();
      } catch (error) {
        logger.error(`Erreur relance soumission ${estimate.estimate_number}: ${error.message}`);
        await tracker.recordFailure(error);
      }
    }

    await client.query("COMMIT");
    logger.info("Billing Assistant Job terminé.");
    return {
      successCount: tracker.successCount,
      failureCount: tracker.failureCount,
      status: tracker.resolveStatus(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Erreur globale dans le Billing Assistant Job:", error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { processReminders };
