const logger = require("../config/logger");
const outboxService = require("../services/outbox.service");
const emailService = require("../services/email.service");
const { createJobResultTracker } = require("./jobResultAggregator");

async function processOutboxEvents() {
  const tracker = createJobResultTracker('Outbox Worker');

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
    try {
      await outboxService.markEventProcessing(event.id);

      const { event_type, payload } = event;

      if (event_type === 'dunning_reminder') {
        const { email, invoice, subType } = payload;
        if (subType === 'final') {
          await emailService.sendFinalReminder(email, invoice, event.id);
        } else if (subType === 'firm') {
          await emailService.sendFirmReminder(email, invoice, event.id);
        } else if (subType === 'gentle') {
          await emailService.sendGentleReminder(email, invoice, event.id);
        }
      } else if (event_type === 'estimate_reminder') {
        const { email, estimate } = payload;
        await emailService.sendEstimateReminder(email, estimate, event.id);
      } else if (event_type === 'recurring_invoice_reminder') {
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
        await outboxService.markEventFailed(event.id, error.message || String(error), 3);
      } catch (err) {
        logger.error(`Failed to mark outbox event ${event.id} as failed:`, err);
      }
    }
  }

  return { successCount: tracker.successCount, failureCount: tracker.failureCount, status: tracker.resolveStatus() };
}

module.exports = { processOutboxEvents };
