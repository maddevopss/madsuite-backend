'use strict';

const DEFAULTS = {
  recommendationsEnabled: true,
  reminderIntensity: 'normal',
  focusMode: 'balanced',
};

function normalizePreferences(input = {}) {
  return { ...DEFAULTS, ...input };
}

module.exports = { DEFAULTS, normalizePreferences };
