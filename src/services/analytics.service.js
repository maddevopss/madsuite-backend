const analyticsRepository = require("./analytics.repository");
const logger = require("../config/logger");

class AnalyticsService {
  /**
   * Track un ǸvǸnement analytique.
   * Cette mǸthode est rǸsiliente et ne doit pas faire Ǹchouer le flux appelant
   * en cas d'erreur de la base de donnǸes.
   */
  async trackEvent(eventName, { organisationId, userId = null, metadata = {} }) {
    if (!organisationId) {
      logger.warn(`Tentative de trackEvent '${eventName}' sans organisationId`);
      return null;
    }

    try {
      return await analyticsRepository.insertEvent({
        organisationId,
        userId,
        eventName,
        metadata,
      });
    } catch (error) {
      // Les Ǹchecs analytiques ne doivent pas impacter la requǦte principale
      logger.error(`Erreur lors du tracking de l'ǸvǸnement analytique '${eventName}':`, error);
      return null;
    }
  }
}

module.exports = new AnalyticsService();
