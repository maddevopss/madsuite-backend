'use strict';

function buildBillJournalEntry(bill, accounts) {
  const totalCents = Number(bill.totalCents);
  const taxCents = Number(bill.taxTotalCents || 0);
  const expenseCents = totalCents - taxCents;
  const lines = [
    { accountId: accounts.expenseAccountId, debitCents: expenseCents, creditCents: 0 },
    ...(taxCents ? [{ accountId: accounts.taxRecoverableAccountId, debitCents: taxCents, creditCents: 0 }] : []),
    { accountId: accounts.accountsPayableAccountId, debitCents: 0, creditCents: totalCents },
  ];
  return { sourceType: 'supplier_bill', sourceId: bill.id, idempotencyKey: `supplier-bill:${bill.id}`, description: `Facture fournisseur ${bill.billNumber}`, lines };
}

function buildPaymentJournalEntry(payment, accounts) {
  return { sourceType: 'supplier_payment', sourceId: payment.id, idempotencyKey: `supplier-payment:${payment.id}`, lines: [
    { accountId: accounts.accountsPayableAccountId, debitCents: payment.amountCents, creditCents: 0 },
    { accountId: accounts.bankAccountId, debitCents: 0, creditCents: payment.amountCents },
  ] };
}

module.exports = { buildBillJournalEntry, buildPaymentJournalEntry };