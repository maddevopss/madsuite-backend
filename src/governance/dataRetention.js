'use strict';

function defineRetentionPolicy({ assetId, retentionDays, justification, archiveAfterDays, legalHold = false, owner }) {
  if (!assetId || !owner || !justification) throw new Error('assetId, owner and justification are required');
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) throw new Error('finite retentionDays is required');
  if (!Number.isInteger(archiveAfterDays) || archiveAfterDays < 0 || archiveAfterDays > retentionDays) throw new Error('invalid archive window');
  return Object.freeze({ assetId, retentionDays, justification, archiveAfterDays, legalHold, owner });
}

function planDeletion(policy, copies) {
  if (policy.legalHold) return Object.freeze({ allowed: false, reason: 'legal_hold', targets: [] });
  if (!Array.isArray(copies) || copies.some(copy => !copy.location || !copy.authorized)) throw new Error('all copies must be identified and authorized');
  return Object.freeze({ allowed: true, reason: null, targets: copies.map(copy => copy.location), verificationRequired: true });
}

module.exports = { defineRetentionPolicy, planDeletion };
