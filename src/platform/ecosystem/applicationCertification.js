'use strict';

const REQUIRED_EVIDENCE = ['security', 'privacy', 'quality', 'support', 'compatibility'];

function certifyApplication(application, decision) {
  if (!application || !application.id || !application.partnerId || !application.version) {
    throw new Error('application identity is incomplete');
  }
  if (!decision || !decision.reviewerId || decision.reviewerId === application.partnerId) {
    throw new Error('independent reviewer is required');
  }
  for (const evidence of REQUIRED_EVIDENCE) {
    if (decision.evidence?.[evidence] !== true) throw new Error(`missing ${evidence} evidence`);
  }
  if (!decision.expiresAt) throw new Error('certification expiration is required');
  return Object.freeze({ applicationId: application.id, version: application.version, status: 'certified', ...decision });
}

function isCertificationUsable(certification, now = new Date()) {
  return certification?.status === 'certified' && new Date(certification.expiresAt) > now;
}

module.exports = { REQUIRED_EVIDENCE, certifyApplication, isCertificationUsable };
