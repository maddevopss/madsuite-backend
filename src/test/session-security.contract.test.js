const { evaluateRefreshToken, revokeTokenFamily } = require('../security/sessionSecurity');

describe('session security', () => {
  test('refuse un jeton expiré', () => {
    expect(evaluateRefreshToken({ token: { expiresAt: '2020-01-01T00:00:00Z' }, now: Date.now() }).code).toBe('session.expired');
  });

  test('détecte la réutilisation après rotation', () => {
    expect(evaluateRefreshToken({ token: { expiresAt: '2999-01-01T00:00:00Z', replacedByTokenId: 2, usedAt: '2026-01-01' } })).toEqual(expect.objectContaining({ code: 'session.reuse_detected', revokeFamily: true }));
  });

  test('révoque toute la famille', () => {
    expect(revokeTokenFamily([{ familyId: 'a' }, { familyId: 'b' }], 'a')[0].revokedAt).toBeTruthy();
  });
});