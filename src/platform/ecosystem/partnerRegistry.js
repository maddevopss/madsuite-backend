'use strict';

const PARTNER_STATUSES = new Set(['proposed', 'verified', 'active', 'suspended', 'revoked']);

function validatePartner(partner) {
  const required = ['id', 'legalName', 'ownerId', 'jurisdiction', 'status', 'reviewedAt'];
  for (const field of required) {
    if (!partner || partner[field] === undefined || partner[field] === null || partner[field] === '') {
      throw new Error(`partner.${field} is required`);
    }
  }
  if (!PARTNER_STATUSES.has(partner.status)) throw new Error('invalid partner status');
  if (partner.status === 'active' && partner.verificationEvidence !== true) {
    throw new Error('active partner requires verification evidence');
  }
  return Object.freeze({ ...partner });
}

function canPartnerOperate(partner) {
  const validated = validatePartner(partner);
  return validated.status === 'active' && validated.verificationEvidence === true;
}

module.exports = { PARTNER_STATUSES, validatePartner, canPartnerOperate };
