'use strict';

const { evaluateCertification } = require('../platform/extensions/extensionCertification');

describe('stage 12F extension certification', () => {
  test('lists missing evidence', () => {
    const result = evaluateCertification({ level: 'verified', evidence: { identity: true } });
    expect(result.certified).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['signature', 'security_review']));
  });

  test('rejects expired certification', () => {
    expect(evaluateCertification({ level: 'community', evidence: { identity: true }, expiresAt: '2020-01-01T00:00:00.000Z' }).reason).toBe('certification_expired');
  });
});
