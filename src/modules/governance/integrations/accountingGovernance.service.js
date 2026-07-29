'use strict';

const SENSITIVE_ACTIONS = new Set([
  'journal_entry.create',
  'journal_entry.adjust',
  'journal_entry.reverse',
  'period.close',
  'write_off.approve',
  'reconciliation.complete',
]);

function evaluateAccountingDecision(input = {}) {
  const {
    organisationId,
    actorId,
    action,
    amount = 0,
    evidenceIds = [],
    approvalIds = [],
    periodLocked = false,
    actorIsPreparer = true,
    actorIsApprover = false,
  } = input;

  const reasons = [];
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!actorId) reasons.push('ACTOR_REQUIRED');
  if (!SENSITIVE_ACTIONS.has(action)) reasons.push('UNKNOWN_ACCOUNTING_ACTION');
  if (periodLocked && action !== 'journal_entry.reverse') reasons.push('PERIOD_LOCKED');
  if (Number(amount) !== 0 && evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');
  if (Math.abs(Number(amount)) >= 10000 && approvalIds.length < 2) reasons.push('DOUBLE_APPROVAL_REQUIRED');
  if (actorIsPreparer && actorIsApprover) reasons.push('DUTY_SEPARATION_VIOLATION');

  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze(reasons),
    governanceContext: Object.freeze({ organisationId, actorId, action, amount: Number(amount) }),
  });
}

module.exports = { SENSITIVE_ACTIONS, evaluateAccountingDecision };
