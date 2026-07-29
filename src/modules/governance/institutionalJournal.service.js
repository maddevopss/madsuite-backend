'use strict';

const JOURNAL_EVENT_TYPES = Object.freeze({
  DECISION_CREATED: 'decision_created',
  DECISION_APPROVED: 'decision_approved',
  DECISION_REJECTED: 'decision_rejected',
  EXCEPTION_GRANTED: 'exception_granted',
  REVIEW_COMPLETED: 'review_completed',
  POLICY_CHANGED: 'policy_changed',
  VERIFICATION_RECORDED: 'verification_recorded',
  DECISION_CLOSED: 'decision_closed',
});

function createJournalEvent({ organisationId, aggregateType, aggregateId, eventType, actorUserId, payload = {}, occurredAt = new Date() }) {
  if (!organisationId || !aggregateType || !aggregateId || !eventType || !actorUserId) {
    throw new TypeError('journal event requires organisation, aggregate, event type and actor');
  }
  if (!Object.values(JOURNAL_EVENT_TYPES).includes(eventType)) {
    throw new TypeError('unknown institutional journal event type');
  }

  return Object.freeze({
    organisationId: String(organisationId),
    aggregateType,
    aggregateId: String(aggregateId),
    eventType,
    actorUserId: String(actorUserId),
    payload: Object.freeze({ ...payload }),
    occurredAt: new Date(occurredAt).toISOString(),
  });
}

function assertAppendOnlyMutation(operation) {
  if (operation !== 'append') {
    throw new Error('institutional journal is append-only');
  }
  return true;
}

module.exports = {
  JOURNAL_EVENT_TYPES,
  createJournalEvent,
  assertAppendOnlyMutation,
};
