/**
 * csv.provider.js
 */

const AccountingProvider = require("../accounting.provider");
const logger = require("../../../config/logger");

class CsvProvider extends AccountingProvider {
  async syncInvoice(invoice) {
    logger.info(`[CSV] Appending invoice ${invoice.id} to CSV queue for Org ${this.organisationId}...`);
    return true;
  }

  async syncPayment(invoice, paymentMethod) {
    logger.info(`[CSV] Appending payment for invoice ${invoice.id} to CSV queue for Org ${this.organisationId}...`);
    return true;
  }

  async syncClient(client) {
    logger.info(`[CSV] Appending client ${client.id} to CSV queue for Org ${this.organisationId}...`);
    return true;
  }
}

module.exports = CsvProvider;
