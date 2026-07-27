'use strict';

const { evaluateSaasPlatformClosure } = require('../services/saasPlatformClosure.service');

const valid = {
  planCatalogVerified: true,
  entitlementsVerified: true,
  quotasVerified: true,
  billingVerified: true,
  trialLifecycleVerified: true,
  subscriptionLifecycleVerified: true,
  tenantIsolationVerified: true,
  administrationVerified: true,
  supportVerified: true,
  auditVerified: true,
  approvedBy: 1,
  approvedAt: '2026-07-28T00:00:00Z',
};

describe('Bloc 19 — Plateforme SaaS', () => {
  test('ferme une plateforme complète et approuvée', () => {
    expect(evaluateSaasPlatformClosure(valid)).toMatchObject({ allowed: true, status: 'closed' });
  });

  test('refuse une fermeture sans facturation vérifiée', () => {
    const result = evaluateSaasPlatformClosure({ ...valid, billingVerified: false });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('billingVerified');
  });

  test('refuse une fermeture sans approbation humaine', () => {
    expect(evaluateSaasPlatformClosure({ ...valid, approvedBy: null }).allowed).toBe(false);
  });
});