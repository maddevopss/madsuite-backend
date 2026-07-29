'use strict';

const TRANSITIONS = Object.freeze({
  draft: ['under_review'],
  under_review: ['approved', 'rejected'],
  approved: ['executed'],
  executed: ['verified'],
  verified: ['closed', 'under_review'],
  rejected: ['closed'],
  closed: [],
});

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

module.exports = { TRANSITIONS, canTransition };
