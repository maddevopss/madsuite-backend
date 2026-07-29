'use strict';

function requireHumanConfirmation(action) {
  return { action, status: 'awaiting_confirmation', executable: false };
}

function confirmHumanAction(pending, userId) {
  return { ...pending, status: 'confirmed', executable: true, confirmedBy: userId, confirmedAt: new Date().toISOString() };
}

module.exports = { requireHumanConfirmation, confirmHumanAction };
