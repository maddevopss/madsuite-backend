'use strict';

function evaluateCredit(customer, openInvoices = []) {
  const exposureCents = openInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.balanceCents || 0), 0);
  const limitCents = Number.isInteger(customer.creditLimitCents) ? customer.creditLimitCents : 0;
  const availableCents = Math.max(0, limitCents - exposureCents);
  return {
    customerId: customer.id,
    limitCents,
    exposureCents,
    availableCents,
    blocked: customer.creditBlocked === true || exposureCents > limitCents,
  };
}

function assertCreditAvailable(customer, openInvoices, requestedCents) {
  if (!Number.isInteger(requestedCents) || requestedCents < 0) throw new Error('CUSTOMER_CREDIT_AMOUNT_INVALID');
  const evaluation = evaluateCredit(customer, openInvoices);
  if (evaluation.blocked || requestedCents > evaluation.availableCents) throw new Error('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
  return evaluation;
}

module.exports = { assertCreditAvailable, evaluateCredit };
