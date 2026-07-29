'use strict';

const DEFAULT_STAGES = [3, 7, 14, 30];

function buildReminderCandidates(invoices = [], asOf = new Date(), stages = DEFAULT_STAGES) {
  return invoices.filter((invoice) => invoice.balanceCents > 0).flatMap((invoice) => {
    const daysPastDue = Math.floor((new Date(asOf) - new Date(invoice.dueDate)) / 86400000);
    const stage = [...stages].sort((a, b) => b - a).find((days) => daysPastDue >= days);
    if (!stage) return [];
    const key = `collection:${invoice.id}:day-${stage}`;
    if (invoice.sentReminderKeys?.includes(key)) return [];
    return [{ invoiceId: invoice.id, customerId: invoice.customerId, daysPastDue, stage, idempotencyKey: key }];
  });
}

function reminderPriority(candidate) {
  if (candidate.daysPastDue >= 30) return 'critical';
  if (candidate.daysPastDue >= 14) return 'high';
  return 'normal';
}

module.exports = { buildReminderCandidates, reminderPriority };
