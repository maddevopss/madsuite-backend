'use strict';

const ACTIONS = new Set(['warn', 'suspend', 'revoke', 'reinstate']);

function recordGovernanceDecision(decision) {
  const required = ['subjectType', 'subjectId', 'action', 'reason', 'decidedBy', 'evidence', 'appealWindowEndsAt'];
  for (const field of required) if (!decision?.[field]) throw new Error(`${field} is required`);
  if (!ACTIONS.has(decision.action)) throw new Error('invalid governance action');
  if (decision.conflictDeclared !== true) throw new Error('conflict-of-interest declaration is required');
  return Object.freeze({ ...decision, recordedAt: new Date().toISOString(), reversible: decision.action !== 'warn' });
}

function canAppeal(decision, now = new Date()) {
  return new Date(decision.appealWindowEndsAt) > now;
}

module.exports = { ACTIONS, recordGovernanceDecision, canAppeal };
