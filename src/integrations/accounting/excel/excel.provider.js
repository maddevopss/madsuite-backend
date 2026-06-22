/**
 * excel.provider.js
 */

const AccountingProvider = require("../accounting.provider");
const logger = require("../../../config/logger");

class ExcelProvider extends AccountingProvider {
  async syncInvoice(invoice) {
    logger.info(`[Excel] Appending invoice ${invoice.id} to queue/export file for Org ${this.organisationId}...`);
    // Logique d'écriture Excel Asynchrone
    return true;
  }

  async syncPayment(invoice, paymentMethod) {
    logger.info(`[Excel] Logging payment for invoice ${invoice.id} for Org ${this.organisationId}...`);
    return true;
  }

  async syncClient(client) {
    logger.info(`[Excel] Appending client ${client.id} to export for Org ${this.organisationId}...`);
    return true;
  }
}

module.exports = ExcelProvider;
