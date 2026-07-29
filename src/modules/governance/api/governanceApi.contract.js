'use strict';

const GOVERNANCE_ACTIONS = Object.freeze([
  'observe',
  'define_need',
  'review_options',
  'assess_risks',
  'attach_evidence',
  'decide',
  'approve',
  'authorize_execution',
  'verify_result',
  'review',
  'close',
]);

function validateGovernanceCommand(command = {}) {
  const errors = [];
  if (!command.organisationId) errors.push('organisationId_required');
  if (!command.aggregateType) errors.push('aggregateType_required');
  if (!command.aggregateId) errors.push('aggregateId_required');
  if (!GOVERNANCE_ACTIONS.includes(command.action)) errors.push('action_invalid');
  if (!command.actorId) errors.push('actorId_required');
  if (!command.idempotencyKey) errors.push('idempotencyKey_required');

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    command: Object.freeze({ ...command }),
  });
}

function createGovernanceResponse({ commandId, state, links = {}, warnings = [] }) {
  if (!commandId || !state) throw new TypeError('commandId_and_state_required');
  return Object.freeze({
    commandId,
    state,
    links: Object.freeze({ ...links }),
    warnings: Object.freeze([...warnings]),
  });
}

module.exports = {
  GOVERNANCE_ACTIONS,
  validateGovernanceCommand,
  createGovernanceResponse,
};
