'use strict';

function buildSupplierStatement({ supplier, openingBalanceCents = 0, bills = [], payments = [], credits = [] }) {
  const transactions = [
    ...bills.map((bill) => ({ date: bill.billDate, type: 'bill', reference: bill.billNumber, amountCents: Number(bill.totalCents) })),
    ...payments.map((payment) => ({ date: payment.paymentDate, type: 'payment', reference: payment.reference, amountCents: -Number(payment.amountCents) })),
    ...credits.map((credit) => ({ date: credit.creditDate, type: 'credit', reference: credit.reference, amountCents: -Number(credit.amountCents) })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let balanceCents = Number(openingBalanceCents);
  const lines = transactions.map((transaction) => ({ ...transaction, balanceCents: (balanceCents += transaction.amountCents) }));
  return { supplier, openingBalanceCents, lines, closingBalanceCents: balanceCents };
}

module.exports = { buildSupplierStatement };