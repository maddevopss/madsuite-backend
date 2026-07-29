'use strict';

function closeWorkSession(session, endedAt = new Date()) {
  const startedAt = new Date(session.startedAt);
  const durationMinutes = Math.max(0, Math.round((endedAt - startedAt) / 60000));
  return { ...session, endedAt: endedAt.toISOString(), durationMinutes, status: 'closed' };
}

module.exports = { closeWorkSession };
