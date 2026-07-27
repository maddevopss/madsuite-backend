'use strict';

const { evaluateIntegrationReadiness } = require('../services/integrationEcosystem.service');

const valid = {
  deliveryVerified: true,
  signatureVerified: true,
  retryVerified: true,
  idempotencyVerified: true,
  reconciliationVerified: true,
  tenantIsolationVerified: true,
  auditVerified: true,
  failureRecoveryVerified: true,
  approvedBy: 1,
  approvedAt: '2026-07-28T00:00:00Z',
};

describe('Bloc 18 — Écosystème', () => {
  test('autorise une intégration complète et approuvée', () => {
    expect(evaluateIntegrationReadiness(valid)).toMatchObject({ allowed: true, status: 'active' });
  });

  test('refuse une intégration sans réconciliation', () => {
    const result = evaluateIntegrationReadiness({ ...valid, reconciliationVerified: false });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('reconciliationVerified');
  });

  test('refuse une intégration sans décision humaine', () => {
    expect(evaluateIntegrationReadiness({ ...valid, approvedAt: null }).allowed).toBe(false);
  });
});