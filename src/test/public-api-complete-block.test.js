'use strict';

const { evaluatePublicApiReadiness } = require('../services/publicApiGovernance.service');

const validInput = {
  authenticationVerified: true,
  authorizationVerified: true,
  tenantIsolationVerified: true,
  rateLimitsVerified: true,
  idempotencyVerified: true,
  versioningVerified: true,
  documentationVerified: true,
  compatibilityVerified: true,
  auditVerified: true,
  approvedBy: 1,
  approvedAt: '2026-07-28T00:00:00Z',
  evidence: { openapi: 'verified', sdk: 'verified' },
};

describe('Bloc 17 — API publique', () => {
  test('autorise uniquement un contrat complet et approuvé', () => {
    expect(evaluatePublicApiReadiness(validInput)).toMatchObject({ allowed: true, status: 'active' });
  });

  test('refuse une API sans isolation multi-organisation', () => {
    const result = evaluatePublicApiReadiness({ ...validInput, tenantIsolationVerified: false });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('tenantIsolationVerified');
  });

  test('refuse une activation sans approbation humaine', () => {
    expect(evaluatePublicApiReadiness({ ...validInput, approvedBy: null })).toMatchObject({ allowed: false, status: 'draft' });
  });
});