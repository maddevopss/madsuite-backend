'use strict';

const { certifyApplication, isCertificationUsable } = require('../platform/ecosystem/applicationCertification');

describe('stage 15 application certification', () => {
  const app = { id: 'a1', partnerId: 'p1', version: '1.0.0' };
  const evidence = { security: true, privacy: true, quality: true, support: true, compatibility: true };

  test('rejects self-certification', () => {
    expect(() => certifyApplication(app, { reviewerId: 'p1', evidence, expiresAt: '2027-01-01' })).toThrow('independent reviewer');
  });

  test('expires certification explicitly', () => {
    const result = certifyApplication(app, { reviewerId: 'mad-review', evidence, expiresAt: '2027-01-01' });
    expect(isCertificationUsable(result, new Date('2026-12-01'))).toBe(true);
    expect(isCertificationUsable(result, new Date('2027-02-01'))).toBe(false);
  });
});
