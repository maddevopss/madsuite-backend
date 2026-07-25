const logger = require("../config/logger");
const outboxService = require("../services/outbox.service");
const emailService = require("../services/email.service");
const paymentReminderDelivery = require("../services/payment-reminder-delivery.service");
const { createEstimatePublicLink } = require("../services/estimate/estimate-public-link.service");
const { createJobResultTracker } = require("./jobResultAggregator");

async function processOutboxEvents() {
  const tracker = createJobResultTracker("Outbox Worker");

  try {
    await outboxService.recoverStuckEvents();
  } catch (error) {
    logger.error("Error recovering stuck outbox events:", error);
  }

  let events;
  try {
    events = await outboxService.fetchPendingEvents(50);
  } catch (error) {
    logger.error("Error fetching outbox events:", error);
    return { successCount: tracker.successCount, failureCount: tracker.failureCount, status: tracker.resolveStatus() };
  }

  if (events.length === 0) return { successCount: tracker.successCount, failureCount: tracker.failureCount, status: tracker.resolveStatus() };

  logger.info(`Processing ${events.length} pending outbox events...`);

  for (const event of events) {
    const reminderAttemptId = event.payload?.reminderAttemptId || null;

    try {
      await outboxService.markEventProcessing(event.id);

      const { event_type, payload } = event;
      if (event_type === "dunning_reminder") {
        const { email, invoice, subType } = payload;
        if (subType === "final") {
          await emailService.sendFinalReminder(email, invoice, event.id);
        } else if (subType === "firm") {
          await emailService.sendFirmReminder(email, invoice, event.id);
        } else if (subType === "gentle") {
          await emailService.sendGentleReminder(email, invoice, event.id);
        }
        await paymentReminderDelivery.markAttemptSent(reminderAttemptId);
      } else if (event_type === "estimate_reminder") {
        const { email, estimate } = payload;
        const link = await createEstimatePublicLink({
          estimateId: estimate.id,
          organisationId: estimate.organisation_id,
          createdBy: null,
          baseUrl: process.env.FRONTEND_URL || "http://localhost:5173",
          expiresInDays: 30,
          req: null,
        });
        if (!link?.portalUrl) {
          throw new Error("Impossible de créer le lien sécurisé de la soumission.");
        }
        await emailService.sendEstimateReminder(
          email,
          { ...estimate, portal_url: link.portalUrl },
          event.id,
        );
      } else if (event_type === "recurring_invoice_reminder") {
        const { email, invoice } = payload;
        await emailService.sendInvoiceReminder(email, invoice, event.id);
      } else {
        logger.warn(`Unknown outbox event type: ${event_type}`);
      }

      await outboxService.markEventCompleted(event.id);
      logger.info(`Successfully processed outbox event ${event.id}`);
      tracker.recordSuccess();
    } catch (error) {
      logger.error(`Failed to process outbox event ${event.id}:`, error);
      await tracker.recordFailure(error, { eventId: event.id });
      try {
        await paymentReminderDelivery.markAttemptFailed(reminderAttemptId, error);
        await outboxService.markEventFailed(event.id, error.message || String(error), 3);
      } catch (err) {
        logger.error(`Failed to mark outbox event ${event.id} as failed:`, err);
      }
    }
  }

  return { successCount: tracker.successCount, failureCount: tracker.failureCount, status: tracker.resolveStatus() };
}

module.exports = { processOutboxEvents };
