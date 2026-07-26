'use strict';

function authorizeExtensionAccess({ grant, organisationId, environment, userId, capability }) {
  if (!grant) return { allowed: false, reason: 'denied_by_default' };
  if (grant.revokedAt) return { allowed: false, reason: 'grant_revoked' };
  if (grant.organisationId !== organisationId) return { allowed: false, reason: 'organisation_mismatch' };
  if (grant.environment !== environment) return { allowed: false, reason: 'environment_mismatch' };
  if (grant.userId && grant.userId !== userId) return { allowed: false, reason: 'user_mismatch' };
  if (!(grant.capabilities || []).includes(capability)) return { allowed: false, reason: 'capability_not_granted' };
  return { allowed: true, grantId: grant.id, reviewedAt: grant.reviewedAt || null };
}

module.exports = { authorizeExtensionAccess };
