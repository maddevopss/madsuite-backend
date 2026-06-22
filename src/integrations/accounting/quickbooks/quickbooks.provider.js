/**
 * quickbooks.provider.js
 */

const AccountingProvider = require("../accounting.provider");
const logger = require("../../../config/logger");

class QuickBooksProvider extends AccountingProvider {
  async syncInvoice(invoice) {
    logger.info(`[QuickBooks] Syncing invoice ${invoice.id} for Org ${this.organisationId}...`);
    // Implémentation réelle avec API QuickBooks SDK
    return true;
  }

  async syncPayment(invoice, paymentMethod) {
    logger.info(`[QuickBooks] Syncing payment for invoice ${invoice.id} for Org ${this.organisationId}...`);
    // Implémentation réelle
    return true;
  }

  async syncClient(client) {
    logger.info(`[QuickBooks] Syncing client ${client.id} for Org ${this.organisationId}...`);
    // Implémentation réelle
    return true;
  }
}

module.exports = QuickBooksProvider;
