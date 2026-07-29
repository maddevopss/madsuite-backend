'use strict';

function buildDailySummary({ completed = [], inProgress = [], interruptions = 0, focusMinutes = 0 } = {}) {
  return { completed, inProgress, interruptions, focusMinutes };
}

module.exports = { buildDailySummary };
