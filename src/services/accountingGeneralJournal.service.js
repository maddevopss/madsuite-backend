'use strict';

function normalizeFilters(filters = {}) {
  return {
    from: filters.from ? new Date(filters.from) : null,
    to: filters.to ? new Date(filters.to) : null,
    accountId: filters.accountId || null,
    reference: filters.reference?.trim() || null,
    status: filters.status || 'posted',
    search: filters.search?.trim().toLowerCase() || null,
  };
}

function matches(entry, filters) {
  const date = new Date(entry.entryDate);
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  if (filters.status && entry.status !== filters.status) return false;
  if (filters.reference && entry.reference !== filters.reference) return false;
  if (filters.accountId && !entry.lines?.some((line) => line.accountId === filters.accountId)) return false;
  if (filters.search) {
    const haystack = `${entry.description || ''} ${entry.reference || ''}`.toLowerCase();
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}

function listGeneralJournal(entries = [], rawFilters = {}) {
  const filters = normalizeFilters(rawFilters);
  return entries.filter((entry) => matches(entry, filters))
    .sort((a, b) => new Date(b.entryDate) - new Date(a.entryDate));
}

module.exports = { listGeneralJournal, matches, normalizeFilters };
