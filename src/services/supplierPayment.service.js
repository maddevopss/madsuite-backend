'use strict';

function allocateSupplierPayment(paymentCents, payables = []) {
  if (!Number.isInteger(paymentCents) || paymentCents <= 0) throw new Error('SUPPLIER_PAYMENT_INVALID');
  let remainingCents = paymentCents;
  const allocations = [...payables]
    .filter((item) => item.balanceCents > 0)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .map((item) => {
      const allocatedCents = Math.min(item.balanceCents, remainingCents);
      remainingCents -= allocatedCents;
      return { payableId: item.id, allocatedCents };
    })
    .filter((item) => item.allocatedCents > 0);
  return { paymentCents, allocations, unallocatedCents: remainingCents };
}

function buildSupplierPaymentEntry(payment, accounts) {
  return {
    reference: `supplier-payment:${payment.id}`,
    idempotencyKey: `supplier-payment:${payment.id}`,
    lines: [
      { accountId: accounts.accountsPayableId, debitCents: payment.amountCents, creditCents: 0 },
      { accountId: accounts.cashId, debitCents: 0, creditCents: payment.amountCents },
    ],
  };
}

module.exports = { allocateSupplierPayment, buildSupplierPaymentEntry };
