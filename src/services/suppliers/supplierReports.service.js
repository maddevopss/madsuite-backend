'use strict';

function buildSupplierSummary({ suppliers = [], bills = [], payments = [] }) {
  const bySupplier = new Map(suppliers.map((supplier) => [supplier.id, { supplier, billedCents: 0, paidCents: 0, outstandingCents: 0, overdueCents: 0 }]));
  for (const bill of bills) {
    const row = bySupplier.get(bill.supplierId);
    if (!row) continue;
    row.billedCents += Number(bill.totalCents || 0);
    row.outstandingCents += Number(bill.outstandingCents || 0);
    if (bill.overdue) row.overdueCents += Number(bill.outstandingCents || 0);
  }
  for (const payment of payments) {
    const row = bySupplier.get(payment.supplierId);
    if (row) row.paidCents += Number(payment.amountCents || 0);
  }
  const rows = [...bySupplier.values()];
  return { rows, totals: rows.reduce((totals, row) => ({ billedCents: totals.billedCents + row.billedCents, paidCents: totals.paidCents + row.paidCents, outstandingCents: totals.outstandingCents + row.outstandingCents, overdueCents: totals.overdueCents + row.overdueCents }), { billedCents: 0, paidCents: 0, outstandingCents: 0, overdueCents: 0 }) };
}

module.exports = { buildSupplierSummary };