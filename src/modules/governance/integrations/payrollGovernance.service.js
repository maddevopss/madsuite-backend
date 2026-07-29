'use strict';

const PAYROLL_ACTIONS = new Set(['salary.change','bonus.grant','deduction.change','overtime.approve','leave.adjust','payroll.correct']);

function evaluatePayrollDecision(input = {}) {
  const { organisationId, employeeId, actorId, action, justification, policyId, evidenceIds = [], approvalIds = [], actorIsBeneficiary = false } = input;
  const reasons = [];
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!employeeId) reasons.push('EMPLOYEE_REQUIRED');
  if (!actorId) reasons.push('ACTOR_REQUIRED');
  if (!PAYROLL_ACTIONS.has(action)) reasons.push('UNKNOWN_PAYROLL_ACTION');
  if (!justification || !String(justification).trim()) reasons.push('JUSTIFICATION_REQUIRED');
  if (!policyId) reasons.push('POLICY_REQUIRED');
  if (evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');
  if (approvalIds.length === 0) reasons.push('APPROVAL_REQUIRED');
  if (actorIsBeneficiary) reasons.push('SELF_APPROVAL_FORBIDDEN');
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons), context: Object.freeze({ organisationId, employeeId, actorId, action }) });
}

module.exports = { PAYROLL_ACTIONS, evaluatePayrollDecision };
