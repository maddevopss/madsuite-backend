/**
 * event-bus.service.js
 * 
 * Orchestrateur centralisé (Event Bus) pour MADSuite.
 * Permet de découpler la logique d'affaires. Au lieu que le service "Invoice" 
 * appelle directement le service "Comptabilité", il émet un événement "InvoicePaid".
 */

const EventEmitter = require("events");
const logger = require("../config/logger");

class EventBus extends EventEmitter {
  constructor() {
    super();
    // Prevent unhandled promise rejections from crashing the bus
    this.on('error', (err) => {
      logger.error('EventBus Exception', err);
    });
  }

  /**
   * Publie un événement de domaine
   * @param {string} eventName Le nom de l'événement (ex: INVOICE_PAID)
   * @param {Object} payload Les données de l'événement
   */
  publish(eventName, payload) {
    logger.info(`[EventBus] Publishing event: ${eventName}`, { organisationId: payload?.organisationId });
    // setTimeout garantit que les listeners s'exécutent de façon asynchrone 
    // et ne bloquent pas le flow principal (fire and forget)
    setTimeout(() => {
      this.emit(eventName, payload);
    }, 0);
  }
}

const eventBus = new EventBus();
module.exports = eventBus;
