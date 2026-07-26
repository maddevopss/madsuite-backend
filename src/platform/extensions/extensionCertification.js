'use strict';

const LEVEL_REQUIREMENTS = {
  community: ['identity'],
  verified: ['identity', 'signature', 'security_review'],
  mad_certified: ['identity', 'signature', 'security_review', 'privacy_review', 'support_commitment', 'reproducible_tests'],
  internal: ['identity', 'signature', 'security_review', 'owner', 'operational_runbook'],
};

function evaluateCertification({ level, evidence = {}, expiresAt, now = new Date() }) {
  const requirements = LEVEL_REQUIREMENTS[level];
  if (!requirements) throw new Error('unknown certification level');
  const missing = requirements.filter((key) => !evidence[key]);
  if (expiresAt && new Date(expiresAt) <= now) return { certified: false, reason: 'certification_expired', missing };
  return { certified: missing.length === 0, level, missing, evaluatedAt: now.toISOString() };
}

module.exports = { LEVEL_REQUIREMENTS, evaluateCertification };
