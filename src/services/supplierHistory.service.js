'use strict';

function buildSupplierHistory(supplier, bills = [], payments = [], credits = []) {
  const events = [
    ...bills.map((bill) => ({ type: 'bill', date: bill.date, amountCents: bill.totalCents, reference: bill.number })),
    ...payments.map((payment) => ({ type: 'payment', date: payment.date, amountCents: -payment.amountCents, reference: payment.reference })),
    ...credits.map((credit) => ({ type: 'credit', date: credit.date, amountCents: -credit.amountCents, reference: credit.reference })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  let runningBalanceCents = 0;
  return {
    supplier: { id: supplier.id, name: supplier.name },
    events: events.map((event) => {
      runningBalanceCents += event.amountCents;
      return { ...event, runningBalanceCents };
    }),
    balanceCents: runningBalanceCents,
  };
}

module.exports = { buildSupplierHistory };
