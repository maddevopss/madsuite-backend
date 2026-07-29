'use strict';

const ALLOWED_STATES = new Set(['flow', 'deep_focus', 'friction', 'fatigue']);

function normalizeCognitiveState(state) {
  return ALLOWED_STATES.has(state) ? state : 'friction';
}

module.exports = { ALLOWED_STATES, normalizeCognitiveState };
