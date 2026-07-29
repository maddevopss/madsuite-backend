'use strict';

function buildProspectiveMemory(items = [], now = new Date()) {
  return items
    .filter((item) => item && item.triggerAt)
    .map((item) => ({ ...item, overdue: new Date(item.triggerAt) < now }))
    .sort((a, b) => new Date(a.triggerAt) - new Date(b.triggerAt));
}

module.exports = { buildProspectiveMemory };
