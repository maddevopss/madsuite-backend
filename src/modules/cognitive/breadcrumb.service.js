'use strict';

function buildCognitiveBreadcrumb(events = []) {
  return events
    .filter((event) => event && event.entityType && event.entityId)
    .slice(-20)
    .map((event) => ({
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action || 'viewed',
      occurredAt: event.occurredAt || new Date().toISOString(),
      label: event.label || null,
    }));
}

module.exports = { buildCognitiveBreadcrumb };
