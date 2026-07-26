function evaluateRefreshToken({ token, now = Date.now(), activeSessions = [] }) {
  if (!token || token.revokedAt) return { allowed: false, code: 'session.revoked' };
  if (new Date(token.expiresAt).getTime() <= now) return { allowed: false, code: 'session.expired' };
  if (token.replacedByTokenId && token.usedAt) return { allowed: false, code: 'session.reuse_detected', revokeFamily: true };
  const concurrent = activeSessions.filter((session) => String(session.userId) === String(token.userId) && !session.revokedAt).length;
  return { contract: 'session-security@1', allowed: true, rotate: true, concurrentSessions: concurrent };
}

function revokeTokenFamily(tokens = [], familyId, revokedAt = new Date().toISOString()) {
  return tokens.map((token) => token.familyId === familyId ? { ...token, revokedAt } : token);
}

module.exports = { evaluateRefreshToken, revokeTokenFamily };