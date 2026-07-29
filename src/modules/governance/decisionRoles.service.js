'use strict';

const DECISION_ROLES = Object.freeze({
  OBSERVER: 'observer',
  CONTRIBUTOR: 'contributor',
  ANALYST: 'analyst',
  RECOMMENDER: 'recommender',
  APPROVER: 'approver',
  DECISION_MAKER: 'decision_maker',
  VERIFIER: 'verifier',
  AUDITOR: 'auditor',
});

const ROLE_CAPABILITIES = Object.freeze({
  [DECISION_ROLES.OBSERVER]: ['decision:read'],
  [DECISION_ROLES.CONTRIBUTOR]: ['decision:read', 'evidence:create'],
  [DECISION_ROLES.ANALYST]: ['decision:read', 'evidence:create', 'analysis:create'],
  [DECISION_ROLES.RECOMMENDER]: ['decision:read', 'analysis:create', 'recommendation:create'],
  [DECISION_ROLES.APPROVER]: ['decision:read', 'approval:create'],
  [DECISION_ROLES.DECISION_MAKER]: ['decision:read', 'decision:decide'],
  [DECISION_ROLES.VERIFIER]: ['decision:read', 'verification:create'],
  [DECISION_ROLES.AUDITOR]: ['decision:read', 'audit:read'],
});

function isDecisionRole(role) {
  return Object.values(DECISION_ROLES).includes(role);
}

function getRoleCapabilities(role) {
  if (!isDecisionRole(role)) return [];
  return [...ROLE_CAPABILITIES[role]];
}

function roleCan(role, capability) {
  return getRoleCapabilities(role).includes(capability);
}

function validateRoleAssignment({ organisationId, userId, role }) {
  if (!organisationId || !userId) {
    return { valid: false, reason: 'organisation_and_user_required' };
  }
  if (!isDecisionRole(role)) {
    return { valid: false, reason: 'unknown_decision_role' };
  }
  return { valid: true, reason: null };
}

module.exports = {
  DECISION_ROLES,
  ROLE_CAPABILITIES,
  isDecisionRole,
  getRoleCapabilities,
  roleCan,
  validateRoleAssignment,
};
