'use strict';

function createEvidenceRecord(input) {
  return {
    id: input.id,
    organisationId: input.organisationId,
    type: String(input.type || 'document'),
    source: String(input.source || '').trim(),
    summary: String(input.summary || '').trim(),
    observedAt: input.observedAt || new Date().toISOString(),
    recordedBy: input.recordedBy,
  };
}

module.exports = { createEvidenceRecord };
