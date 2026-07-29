'use strict';

function buildPaymentSchedule(bills = [], asOf = new Date()) {
  const today = new Date(asOf);
  return bills.filter((bill) => ['approved', 'partially_paid'].includes(bill.status)).map((bill) => {
    const due = new Date(`${bill.dueDate}T00:00:00.000Z`);
    const outstandingCents = Number(bill.totalCents) - Number(bill.paidCents || 0) - Number(bill.creditCents || 0);
    const daysUntilDue = Math.ceil((due - today) / 86400000);
    return { ...bill, outstandingCents, daysUntilDue, overdue: daysUntilDue < 0 };
  }).filter((bill) => bill.outstandingCents > 0).sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

module.exports = { buildPaymentSchedule };