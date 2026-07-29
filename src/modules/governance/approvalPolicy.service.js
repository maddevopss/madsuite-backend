'use strict';

const APPROVAL_MODES = Object.freeze({
  NONE: 'none',
  SINGLE: 'single',
  DUAL: 'dual',
  HIERARCHICAL: 'hierarchical',
  CONSENSUS: 'consensus',
});

function evaluateApprovalPolicy({ mode, approvals = [], requiredRoles = [], minimum = 0 }) {
  const uniqueApprovers = new Set(approvals.map((item) => String(item.userId)));
  const approvedRoles = new Set(approvals.map((item) => item.role).filter(Boolean));

  if (mode === APPROVAL_MODES.NONE) return { approved: true, missing: [] };

  const requiredCount = mode === APPROVAL_MODES.SINGLE
    ? 1
    : mode === APPROVAL_MODES.DUAL
      ? 2
      : Math.max(minimum, requiredRoles.length);

  const missingRoles = requiredRoles.filter((role) => !approvedRoles.has(role));
  const approved = uniqueApprovers.size >= requiredCount && missingRoles.length === 0;

  return {
    approved,
    requiredCount,
    receivedCount: uniqueApprovers.size,
    missing: missingRoles,
    reason: approved ? null : 'required_approvals_missing',
  };
}

module.exports = { APPROVAL_MODES, evaluateApprovalPolicy };
