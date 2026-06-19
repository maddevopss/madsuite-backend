const cron = require("node-cron");

const logger = require("../config/logger");
const { aggregateActivityLogs } = require("./aggregateActivityLogs");
const { checkLongRunningTimers } = require("./checkLongRunningTimers");
const { processReminders } = require("./billingAssistantJob");
const { processSecurityBuffer } = require("./securityBufferJob");

function startSchedulers() {
  // Agrégation toutes les heures pour garder activity_logs léger
  const activityAggregationTask = cron.schedule("5 * * * *", async () => {
    logger.info("Lancement de l'agrégation incrémentale...");

    try {
      await aggregateActivityLogs();

      logger.info("Aggregation activity_logs terminee");
    } catch (error) {
      logger.error("Erreur scheduler activity_logs", { error });
    }
  });

  const longRunningTimersTask = cron.schedule("*/15 * * * *", async () => {
    try {
      await checkLongRunningTimers();
    } catch (error) {
      logger.error("Erreur scheduler timers long-running", { error });
    }
  });

  const billingAssistantTask = cron.schedule("0 8 * * *", async () => {
    try {
      await processReminders();
    } catch (error) {
      logger.error("Erreur scheduler billing assistant", { error });
    }
  });

  // Tâche de sécurité: vérifier le buffer d'incidents toutes les 10 minutes
  const securityBufferTask = cron.schedule("*/10 * * * *", async () => {
    try {
      await processSecurityBuffer();
    } catch (error) {
      logger.error("Erreur scheduler security buffer", { error });
    }
  });

  logger.info("Schedulers demarres");

  return [activityAggregationTask, longRunningTimersTask, billingAssistantTask, securityBufferTask];
}

module.exports = { startSchedulers };
