'use strict';

const TRANSITIONS = {
  installed: ['active', 'removed'],
  active: ['suspended', 'rollback_pending'],
  suspended: ['active', 'removed'],
  rollback_pending: ['active', 'suspended'],
  removed: [],
};

function transitionExtension({ currentState, nextState, approvedBy, compatibility, rollbackPlan }) {
  if (!(TRANSITIONS[currentState] || []).includes(nextState)) throw new Error('invalid extension lifecycle transition');
  if (!approvedBy) throw new Error('human approval is required');
  if (nextState === 'active' && !compatibility?.compatible) throw new Error('core compatibility is required');
  if (nextState === 'rollback_pending' && !rollbackPlan?.tested) throw new Error('tested rollback plan is required');
  return { currentState, nextState, approvedBy, changedAt: new Date().toISOString() };
}

module.exports = { TRANSITIONS, transitionExtension };
