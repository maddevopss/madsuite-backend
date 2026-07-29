'use strict';

function buildTemporalContext({ now = new Date(), dueAt = null, lastTouchedAt = null } = {}) {
  return {
    now: now.toISOString(),
    dueAt,
    lastTouchedAt,
    minutesUntilDue: dueAt ? Math.round((new Date(dueAt) - now) / 60000) : null,
  };
}

module.exports = { buildTemporalContext };
