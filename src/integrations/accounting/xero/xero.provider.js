/**
 * xero.provider.js
 */

const AccountingProvider = require("../accounting.provider");
const logger = require("../../../config/logger");

class XeroProvider extends AccountingProvider {
  async syncInvoice(invoice) {
    logger.info(`[Xero] Syncing invoice ${invoice.id} for Org ${this.organisationId}...`);
    // Implémentation réelle avec API Xero SDK
    return true;
  }

  async syncPayment(invoice, paymentMethod) {
    logger.info(`[Xero] Syncing payment for invoice ${invoice.id} for Org ${this.organisationId}...`);
    return true;
  }

  async syncClient(client) {
    logger.info(`[Xero] Syncing client ${client.id} for Org ${this.organisationId}...`);
    return true;
  }
}

module.exports = XeroProvider;
