const crypto = require('crypto');

const SENSITIVE_KEYS = new Set(['password', 'token', 'authorization', 'cookie', 'secret', 'refreshToken', 'accessToken']);

function correlationId(value) {
  const candidate = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redact(item)]));
}

function structuredEvent({ level = 'info', module, event, correlation, organisationId = null, data = {}, now = new Date() } = {}) {
  if (!module || !event) throw new Error('observability.event.invalid');
  return {
    contract: 'structured-log@1',
    timestamp: now.toISOString(),
    level: String(level),
    module: String(module),
    event: String(event),
    correlationId: correlationId(correlation),
    organisationId: organisationId === null ? null : String(organisationId),
    data: redact(data),
  };
}

module.exports = { SENSITIVE_KEYS, correlationId, redact, structuredEvent };
