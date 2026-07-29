'use strict';

function normalizeEvidence(items = []) {
  return items.map((item) => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    observedAt: item.observedAt || null,
    summary: item.summary || null,
  }));
}

module.exports = { normalizeEvidence };
