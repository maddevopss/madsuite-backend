'use strict';

function assertSecretReference(secret) {
  const required = ['integrationId', 'organisationId', 'environment', 'vaultRef', 'status', 'expiresAt'];
  for (const field of required) if (!secret[field]) throw new Error(`integration_secret.${field}.required`);
  if (!['active', 'rotating', 'revoked', 'expired'].includes(secret.status)) throw new Error('integration_secret.status.invalid');
  if (!/^vault:\/\//.test(secret.vaultRef)) throw new Error('integration_secret.vault_ref.invalid');
  return Object.freeze({ ...secret });
}

function rotateSecret(current, replacement, now = new Date()) {
  assertSecretReference(current);
  assertSecretReference(replacement);
  if (current.organisationId !== replacement.organisationId || current.environment !== replacement.environment) {
    throw new Error('integration_secret.scope_mismatch');
  }
  return Object.freeze({ previous: { ...current, status: 'revoked', revokedAt: now.toISOString() }, current: replacement });
}

function redactSecret(value) {
  if (!value || typeof value !== 'object') return value;
  const result = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /secret|token|password|authorization|api[_-]?key/i.test(key) ? '[REDACTED]' : redactSecret(item);
  }
  return result;
}

module.exports = { assertSecretReference, rotateSecret, redactSecret };
