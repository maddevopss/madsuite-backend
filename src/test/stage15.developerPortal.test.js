'use strict';

const { issueDeveloperCredential, publishContract } = require('../platform/ecosystem/developerPortal');

describe('stage 15 developer portal', () => {
  test('requires sandbox validation before production credentials', () => {
    expect(() => issueDeveloperCredential({ partnerId: 'p1', applicationId: 'a1', environment: 'production', scopes: ['clients:read'], expiresAt: '2027-01-01', approvedBy: 'mad' })).toThrow('sandbox validation');
  });

  test('publishes only versioned contracts', () => {
    expect(publishContract({ name: 'clients', version: '1.0.0', schema: {}, compatibilityPolicy: 'one-major-window' }).published).toBe(true);
  });
});
