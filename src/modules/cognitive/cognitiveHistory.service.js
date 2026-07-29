'use strict';

function summarizeCognitiveHistory(events = []) {
  return events.reduce((summary, event) => {
    const state = event.state || 'unknown';
    summary[state] = (summary[state] || 0) + Number(event.durationMinutes || 0);
    return summary;
  }, {});
}

module.exports = { summarizeCognitiveHistory };
