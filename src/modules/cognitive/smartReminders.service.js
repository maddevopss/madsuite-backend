'use strict';

function shouldSendReminder({ dueAt, quietUntil = null, remindersEnabled = true }, now = new Date()) {
  if (!remindersEnabled || !dueAt) return false;
  if (quietUntil && new Date(quietUntil) > now) return false;
  return new Date(dueAt) <= now;
}

module.exports = { shouldSendReminder };
