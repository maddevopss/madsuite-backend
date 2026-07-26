'use strict';

const LEVELS = Object.freeze(['public', 'internal', 'confidential', 'highly_sensitive']);
const ACCESS = Object.freeze({
  public: ['read'],
  internal: ['authenticated_read'],
  confidential: ['owner_approved_read'],
  highly_sensitive: ['explicit_privileged_read']
});

function classifyData({ assetId, level, owner, justification }) {
  if (!assetId || !owner || !justification) throw new Error('assetId, owner and justification are required');
  if (!LEVELS.includes(level)) throw new Error('unknown or missing classification');
  return Object.freeze({ assetId, level, owner, justification, allowedAccess: ACCESS[level] });
}

function authorizeClassifiedAccess(classification, requestedAccess) {
  if (!classification || !LEVELS.includes(classification.level)) return false;
  return classification.allowedAccess.includes(requestedAccess);
}

module.exports = { LEVELS, classifyData, authorizeClassifiedAccess };
