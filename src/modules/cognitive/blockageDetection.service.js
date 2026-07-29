'use strict';

function detectBlockage({ repeatedAttempts = 0, inactiveMinutes = 0, frictionMinutes = 0 } = {}) {
  const signals = [];
  if (repeatedAttempts >= 3) signals.push('repeated_attempts');
  if (inactiveMinutes >= 20) signals.push('inactivity');
  if (frictionMinutes >= 15) signals.push('friction');
  return { detected: signals.length >= 2, signals };
}

module.exports = { detectBlockage };
