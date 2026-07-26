'use strict';

function verifyExtensionPackage({ packageHash, signedHash, publisherKey, revokedKeyIds = [], expiresAt, now = new Date() }) {
  if (!publisherKey?.id || !publisherKey?.verified) return { valid: false, reason: 'publisher_key_unverified' };
  if (revokedKeyIds.includes(publisherKey.id)) return { valid: false, reason: 'publisher_key_revoked' };
  if (expiresAt && new Date(expiresAt) <= now) return { valid: false, reason: 'package_expired' };
  if (!packageHash || packageHash !== signedHash) return { valid: false, reason: 'package_integrity_mismatch' };
  return { valid: true, publisherKeyId: publisherKey.id, verifiedAt: now.toISOString() };
}

module.exports = { verifyExtensionPackage };
