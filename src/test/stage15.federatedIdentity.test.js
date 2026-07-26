'use strict';

const { validateFederatedLogin } = require('../platform/ecosystem/federatedIdentity');

describe('stage 15 federated identity', () => {
  test('separates identity from authorization and organisation scope', () => {
    expect(() => validateFederatedLogin({ issuer: 'idp', subject: 'u1', audience: 'madsuite', expiresAt: '2099-01-01', organisationId: 'org-a' }, { organisationId: 'org-b', scopes: ['clients:read'], consent: true })).toThrow('organisation mismatch');
  });

  test('requires explicit consent and scopes', () => {
    expect(() => validateFederatedLogin({ issuer: 'idp', subject: 'u1', audience: 'madsuite', expiresAt: '2099-01-01' }, { organisationId: 'org-a', scopes: [] })).toThrow('explicit authorization');
  });
});
