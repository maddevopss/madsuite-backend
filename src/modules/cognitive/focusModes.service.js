'use strict';

const MODES = {
  balanced: { notifications: 'normal', sessionMinutes: 45 },
  deep_focus: { notifications: 'minimal', sessionMinutes: 90 },
  recovery: { notifications: 'low', sessionMinutes: 25 },
};

function getFocusMode(name) {
  return MODES[name] || MODES.balanced;
}

module.exports = { MODES, getFocusMode };
