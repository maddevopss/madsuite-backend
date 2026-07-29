'use strict';

function buildSuggestion({ message, reason, evidence = [], action = null }) {
  return { message, reason, evidence, action, requiresHumanConfirmation: true };
}

module.exports = { buildSuggestion };
