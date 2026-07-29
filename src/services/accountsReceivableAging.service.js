'use strict';

const BUCKETS = ['current', '1_30', '31_60', '61_90', 'over_90'];

function bucketFor(daysPastDue) {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return '1_30';
  if (daysPastDue <= 60) return '31_60';
  if (daysPastDue <= 90) return '61_90';
  return 'over_90';
}

function buildReceivablesAging(invoices = [], asOf = new Date()) {
  const totals = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  const rows = invoices.filter((invoice) => invoice.balanceCents > 0).map((invoice) => {
    const daysPastDue = Math.floor((new Date(asOf) - new Date(invoice.dueDate)) / 86400000);
    const bucket = bucketFor(daysPastDue);
    totals[bucket] += invoice.balanceCents;
    return { ...invoice, daysPastDue, bucket };
  });
  return { rows, totals, totalCents: Object.values(totals).reduce((sum, value) => sum + value, 0) };
}

module.exports = { bucketFor, buildReceivablesAging };
