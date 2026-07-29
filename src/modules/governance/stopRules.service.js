'use strict';

const STOP_REASONS = Object.freeze({
  MISSING_EVIDENCE: 'missing_evidence',
  MISSING_APPROVAL: 'missing_approval',
  UNACCEPTABLE_RISK: 'unacceptable_risk',
  EXPIRED_POLICY: 'expired_policy',
  DUTY_CONFLICT: 'duty_conflict',
  INVALID_SIGNATURE: 'invalid_signature',
});

function evaluateStopRules(context = {}) {
  const reasons = [];
  if (context.hasRequiredEvidence === false) reasons.push(STOP_REASONS.MISSING_EVIDENCE);
  if (context.hasRequiredApprovals === false) reasons.push(STOP_REASONS.MISSING_APPROVAL);
  if (context.riskAcceptable === false) reasons.push(STOP_REASONS.UNACCEPTABLE_RISK);
  if (context.policyCurrent === false) reasons.push(STOP_REASONS.EXPIRED_POLICY);
  if (context.hasDutyConflict === true) reasons.push(STOP_REASONS.DUTY_CONFLICT);
  if (context.signatureValid === false) reasons.push(STOP_REASONS.INVALID_SIGNATURE);

  return {
    stopped: reasons.length > 0,
    allowed: reasons.length === 0,
    reasons,
  };
}

module.exports = { STOP_REASONS, evaluateStopRules };
