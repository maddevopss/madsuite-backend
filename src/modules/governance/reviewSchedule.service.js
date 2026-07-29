'use strict';

const REVIEW_TRIGGERS = Object.freeze({
  DUE_DATE: 'due_date',
  REGULATORY_CHANGE: 'regulatory_change',
  NEW_EVIDENCE: 'new_evidence',
  INCIDENT: 'incident',
  AUDIT: 'audit',
  ORGANISATIONAL_CHANGE: 'organisational_change',
});

function shouldScheduleReview({ nextReviewAt, triggers = [], now = new Date() }) {
  const due = nextReviewAt ? new Date(nextReviewAt) <= now : false;
  const activeTriggers = triggers.filter((trigger) => Object.values(REVIEW_TRIGGERS).includes(trigger));
  return {
    required: due || activeTriggers.length > 0,
    due,
    triggers: activeTriggers,
    reason: due ? REVIEW_TRIGGERS.DUE_DATE : activeTriggers[0] || null,
  };
}

function computeNextReviewAt({ reviewedAt = new Date(), intervalDays }) {
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    throw new TypeError('intervalDays must be a positive integer');
  }
  const next = new Date(reviewedAt);
  next.setUTCDate(next.getUTCDate() + intervalDays);
  return next;
}

module.exports = { REVIEW_TRIGGERS, shouldScheduleReview, computeNextReviewAt };
