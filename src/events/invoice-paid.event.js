/**
 * invoice-paid.event.js
 */

const eventBus = require("./event-bus.service");

const INVOICE_PAID = "INVOICE_PAID";

function publishInvoicePaid(invoice, paymentMethod) {
  eventBus.publish(INVOICE_PAID, {
    invoiceId: invoice.id,
    organisationId: invoice.organisation_id,
    amount: invoice.total,
    clientId: invoice.client_id,
    paymentMethod,
    timestamp: new Date()
  });
}

module.exports = {
  INVOICE_PAID,
  publishInvoicePaid
};
