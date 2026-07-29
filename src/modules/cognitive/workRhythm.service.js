'use strict';

function summarizeWorkRhythm(sessions = []) {
  if (!sessions.length) return { preferredHour: null, averageMinutes: 0 };
  const hours = sessions.map((session) => new Date(session.startedAt).getHours());
  const durations = sessions.map((session) => Number(session.durationMinutes || 0));
  return {
    preferredHour: Math.round(hours.reduce((a, b) => a + b, 0) / hours.length),
    averageMinutes: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
  };
}

module.exports = { summarizeWorkRhythm };
