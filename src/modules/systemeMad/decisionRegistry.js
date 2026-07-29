'use strict';

const DECISION_STATES = Object.freeze(['draft', 'under_review', 'approved', 'rejected', 'executed', 'verified', 'closed']);

function createDecisionRecord(input) {
  return {
    id: input.id,
    organisationId: input.organisationId,
    title: String(input.title || '').trim(),
    statement: String(input.statement || '').trim(),
    state: DECISION_STATES.includes(input.state) ? input.state : 'draft',
    createdBy: input.createdBy,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

module.exports = { DECISION_STATES, createDecisionRecord };
