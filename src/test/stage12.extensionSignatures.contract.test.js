'use strict';

const { verifyExtensionPackage } = require('../platform/extensions/extensionSignaturePolicy');

describe('stage 12D extension signatures', () => {
  test('rejects modified packages', () => {
    expect(verifyExtensionPackage({ packageHash: 'a', signedHash: 'b', publisherKey: { id: 'k1', verified: true } }).valid).toBe(false);
  });

  test('rejects revoked publisher keys', () => {
    expect(verifyExtensionPackage({ packageHash: 'a', signedHash: 'a', publisherKey: { id: 'k1', verified: true }, revokedKeyIds: ['k1'] })).toEqual({ valid: false, reason: 'publisher_key_revoked' });
  });
});
