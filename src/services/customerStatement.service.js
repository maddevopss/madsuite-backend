'use strict';

function buildCustomerStatement(customer, transactions = [], period = {}) {
  const rows = transactions
    .filter((item) => (!period.from || new Date(item.date) >= new Date(period.from))
      && (!period.to || new Date(item.date) <= new Date(period.to)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  let runningBalanceCents = period.openingBalanceCents || 0;
  const statementRows = rows.map((item) => {
    runningBalanceCents += (item.debitCents || 0) - (item.creditCents || 0);
    return { ...item, runningBalanceCents };
  });
  return {
    customer: { id: customer.id, name: customer.name, email: customer.email },
    period,
    openingBalanceCents: period.openingBalanceCents || 0,
    rows: statementRows,
    closingBalanceCents: runningBalanceCents,
  };
}

module.exports = { buildCustomerStatement };
