/**
 * invoice-created.event.js
 */

const eventBus = require("./event-bus.service");

const INVOICE_CREATED = "INVOICE_CREATED";

function publishInvoiceCreated(invoice) {
  eventBus.publish(INVOICE_CREATED, {
    invoiceId: invoice.id,
    organisationId: invoice.organisation_id,
    amount: invoice.total,
    clientId: invoice.client_id,
    timestamp: new Date()
  });
}

module.exports = {
  INVOICE_CREATED,
  publishInvoiceCreated
};
