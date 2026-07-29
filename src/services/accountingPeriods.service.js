'use strict';

const VALID_STATUSES = new Set(['open', 'closed', 'locked']);

function assertPeriod(period) {
  if (!period?.startsAt || !period?.endsAt) throw new Error('ACCOUNTING_PERIOD_DATES_REQUIRED');
  if (new Date(period.startsAt) > new Date(period.endsAt)) throw new Error('ACCOUNTING_PERIOD_INVALID_RANGE');
  if (!VALID_STATUSES.has(period.status)) throw new Error('ACCOUNTING_PERIOD_INVALID_STATUS');
  return period;
}

function overlaps(left, right) {
  return new Date(left.startsAt) <= new Date(right.endsAt)
    && new Date(right.startsAt) <= new Date(left.endsAt);
}

function assertNoOverlap(candidate, existingPeriods = []) {
  assertPeriod(candidate);
  if (existingPeriods.some((period) => period.id !== candidate.id && overlaps(candidate, period))) {
    throw new Error('ACCOUNTING_PERIOD_OVERLAP');
  }
  return candidate;
}

function assertPostingAllowed(period, postingDate) {
  assertPeriod(period);
  const date = new Date(postingDate);
  if (period.status !== 'open') throw new Error('ACCOUNTING_PERIOD_NOT_OPEN');
  if (date < new Date(period.startsAt) || date > new Date(period.endsAt)) {
    throw new Error('ACCOUNTING_POSTING_OUTSIDE_PERIOD');
  }
  return true;
}

function transitionPeriod(period, nextStatus) {
  assertPeriod(period);
  const transitions = { open: ['closed'], closed: ['open', 'locked'], locked: [] };
  if (!transitions[period.status].includes(nextStatus)) throw new Error('ACCOUNTING_PERIOD_TRANSITION_FORBIDDEN');
  return { ...period, status: nextStatus };
}

module.exports = { assertPeriod, assertNoOverlap, assertPostingAllowed, overlaps, transitionPeriod };
