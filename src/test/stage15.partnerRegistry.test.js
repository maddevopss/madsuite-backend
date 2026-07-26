'use strict';

const { validatePartner, canPartnerOperate } = require('../platform/ecosystem/partnerRegistry');

describe('stage 15 partner registry', () => {
  test('refuses activation without verification evidence', () => {
    expect(() => validatePartner({ id: 'p1', legalName: 'Partenaire', ownerId: 'u1', jurisdiction: 'CA-QC', status: 'active', reviewedAt: '2026-07-26' })).toThrow('verification evidence');
  });

  test('allows only a verified active partner to operate', () => {
    expect(canPartnerOperate({ id: 'p1', legalName: 'Partenaire', ownerId: 'u1', jurisdiction: 'CA-QC', status: 'active', reviewedAt: '2026-07-26', verificationEvidence: true })).toBe(true);
  });
});
