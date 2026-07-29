'use strict';

const OPERATION_TYPES = new Set(['incident','problem','change','maintenance','backup','restore','capacity','availability']);
const OPERATION_STATES = Object.freeze(['observation','analysis','decision','approval','execution','verification','closed']);

function evaluateOperationalTransition(input = {}) {
  const { organisationId, operationId, type, currentState, nextState, evidenceIds = [], approvalIds = [], verificationPassed = false } = input;
  const reasons = [];
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!operationId) reasons.push('OPERATION_REQUIRED');
  if (!OPERATION_TYPES.has(type)) reasons.push('UNKNOWN_OPERATION_TYPE');
  const currentIndex = OPERATION_STATES.indexOf(currentState);
  const nextIndex = OPERATION_STATES.indexOf(nextState);
  if (currentIndex < 0 || nextIndex < 0) reasons.push('UNKNOWN_OPERATION_STATE');
  if (currentIndex >= 0 && nextIndex !== currentIndex + 1) reasons.push('INVALID_STATE_TRANSITION');
  if (nextState === 'approval' && evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');
  if (nextState === 'execution' && approvalIds.length === 0) reasons.push('APPROVAL_REQUIRED');
  if (nextState === 'closed' && !verificationPassed) reasons.push('VERIFICATION_REQUIRED');

  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze(reasons),
    transition: Object.freeze({ organisationId, operationId, type, currentState, nextState }),
  });
}

module.exports = { OPERATION_TYPES, OPERATION_STATES, evaluateOperationalTransition };
