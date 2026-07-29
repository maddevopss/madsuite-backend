'use strict';

function createCognitiveAuditEvent(event) {
  return {
    organisationId: event.organisationId,
    userId: event.userId,
    eventType: event.eventType,
    subjectId: event.subjectId || null,
    payload: event.payload || {},
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

module.exports = { createCognitiveAuditEvent };
