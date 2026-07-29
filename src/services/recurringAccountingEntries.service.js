'use strict';

function nextOccurrence(rule, fromDate = new Date()) {
  const date = new Date(fromDate);
  const interval = rule.interval || 'monthly';
  if (interval === 'monthly') date.setMonth(date.getMonth() + 1);
  else if (interval === 'weekly') date.setDate(date.getDate() + 7);
  else if (interval === 'yearly') date.setFullYear(date.getFullYear() + 1);
  else throw new Error('RECURRING_ENTRY_INTERVAL_INVALID');
  return date;
}

function instantiateRecurringEntry(template, occurrenceDate) {
  if (!template?.lines?.length) throw new Error('RECURRING_ENTRY_LINES_REQUIRED');
  return {
    description: template.description,
    entryDate: new Date(occurrenceDate).toISOString().slice(0, 10),
    reference: `recurring:${template.id}:${new Date(occurrenceDate).toISOString().slice(0, 10)}`,
    idempotencyKey: `recurring:${template.id}:${new Date(occurrenceDate).toISOString().slice(0, 10)}`,
    lines: template.lines.map((line) => ({ ...line })),
  };
}

module.exports = { instantiateRecurringEntry, nextOccurrence };
