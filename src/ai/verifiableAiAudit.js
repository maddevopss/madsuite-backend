const SECRET_KEYS = /password|token|secret|authorization|cookie/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
}

function createAiAuditRecord(input) {
  const required = ['requestId', 'useCaseId', 'engineVersion', 'organisationId', 'requestedBy', 'result', 'humanDecision'];
  for (const field of required) if (input?.[field] === undefined || input?.[field] === null) throw new Error(`ai.audit.${field}_required`);
  return Object.freeze({
    contract: 'verifiable-ai-audit@1',
    requestId: input.requestId,
    correlationId: input.correlationId || input.requestId,
    useCaseId: input.useCaseId,
    engineVersion: input.engineVersion,
    organisationId: input.organisationId,
    requestedBy: input.requestedBy,
    businessObject: input.businessObject || null,
    transactionId: input.transactionId || null,
    authorizedContext: redact(input.authorizedContext || {}),
    result: redact(input.result),
    humanDecision: redact(input.humanDecision),
    retentionClass: input.retentionClass || 'risk-based',
    recordedAt: new Date().toISOString(),
  });
}

module.exports = { redact, createAiAuditRecord };
