'use strict';

function buildPayableFromBill(bill, accounts) {
  if (!Number.isInteger(bill.totalCents) || bill.totalCents <= 0) throw new Error('PAYABLE_TOTAL_INVALID');
  return {
    supplierId: bill.supplierId,
    billId: bill.id,
    dueDate: bill.dueDate,
    balanceCents: bill.totalCents,
    status: 'open',
    journalEntry: {
      reference: `supplier-bill:${bill.id}`,
      idempotencyKey: `supplier-bill:${bill.id}`,
      lines: [
        { accountId: accounts.expenseOrAssetId, debitCents: bill.totalCents, creditCents: 0 },
        { accountId: accounts.accountsPayableId, debitCents: 0, creditCents: bill.totalCents },
      ],
    },
  };
}

function applySupplierPayment(payable, paymentCents) {
  if (!Number.isInteger(paymentCents) || paymentCents <= 0) throw new Error('SUPPLIER_PAYMENT_INVALID');
  if (paymentCents > payable.balanceCents) throw new Error('SUPPLIER_PAYMENT_EXCEEDS_BALANCE');
  const balanceCents = payable.balanceCents - paymentCents;
  return { ...payable, balanceCents, status: balanceCents === 0 ? 'paid' : 'partial' };
}

module.exports = { applySupplierPayment, buildPayableFromBill };
