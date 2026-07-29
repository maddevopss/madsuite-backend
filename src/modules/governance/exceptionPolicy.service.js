'use strict';

function validateGovernanceException(exception = {}, now = new Date()) {
  const required = ['organisationId', 'responsibleUserId', 'justification', 'scope', 'startsAt', 'expiresAt'];
  const missing = required.filter((field) => !exception[field]);
  if (missing.length) {
    return { valid: false, reason: 'exception_fields_missing', missing };
  }

  const startsAt = new Date(exception.startsAt);
  const expiresAt = new Date(exception.expiresAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt) {
    return { valid: false, reason: 'invalid_exception_period', missing: [] };
  }

  const active = startsAt <= now && now < expiresAt;
  return {
    valid: true,
    active,
    expired: now >= expiresAt,
    reason: active ? null : 'exception_not_active',
    missing: [],
  };
}

function canUseException(exception, context = {}, now = new Date()) {
  const validation = validateGovernanceException(exception, now);
  if (!validation.valid || !validation.active) return validation;
  if (String(exception.organisationId) !== String(context.organisationId)) {
    return { valid: false, active: false, reason: 'cross_organisation_exception' };
  }
  return { valid: true, active: true, reason: null };
}

module.exports = { validateGovernanceException, canUseException };
