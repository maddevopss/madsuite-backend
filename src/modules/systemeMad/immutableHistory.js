'use strict';

function appendHistoryEvent(history, event) {
  return Object.freeze([
    ...history,
    Object.freeze({
      ...event,
      recordedAt: event.recordedAt || new Date().toISOString(),
    }),
  ]);
}

module.exports = { appendHistoryEvent };
