const { validateAuthorizationMatrix } = require('../security/authorizationMatrix');
const { assertSameOrganisation } = require('../security/tenantIsolation');
const { guardSensitiveTransition } = require('../security/sensitiveTransitionGuard');
const { redactRecord } = require('../security/sensitiveDataPolicy');
const { evaluateRefreshToken } = require('../security/sessionSecurity');
const { releaseGate } = require('../security/supplyChainPolicy');
const { evaluateRequestBudget } = require('../security/abuseProtection');

describe('stage 6 security closure', () => {
  test('assemble une preuve transversale de sécurité', () => {
    expect(validateAuthorizationMatrix([]).valid).toBe(true);
    expect(assertSameOrganisation({ actorOrganisationId: 1, resourceOrganisationId: 1 }).isolated).toBe(true);
    expect(guardSensitiveTransition({ actor: { id: 1 }, resource: { created_by: 2 }, payload: {}, idempotencyKey: 'safe-key' }).allowed).toBe(true);
    expect(redactRecord({ token: 'secret' }).token).toBe('[REDACTED]');
    expect(evaluateRefreshToken({ token: { userId: 1, expiresAt: '2999-01-01T00:00:00Z' } }).allowed).toBe(true);
    expect(releaseGate([]).allowed).toBe(true);
    expect(evaluateRequestBudget({}).allowed).toBe(true);
  });
});