'use strict';

function prepareNextSession(input = {}) {
  return {
    resumePoint: input.resumePoint || null,
    topTasks: Array.isArray(input.topTasks) ? input.topTasks.slice(0, 3) : [],
    note: input.note || null,
  };
}

module.exports = { prepareNextSession };
