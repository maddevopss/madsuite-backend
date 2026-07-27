const crypto = require('crypto');

function buildAuditEvent(input = {}) {
  const payload = {
    recommendationId: input.recommendationId || null,
    eventType: String(input.eventType || ''),
    actorType: String(input.actorType || ''),
    actorId: input.actorId || null,
    inputSnapshot: input.inputSnapshot || {},
    outputSnapshot: input.outputSnapshot || {},
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
    policyVersion: input.policyVersion || null,
    modelReference: input.modelReference || null,
    previousEventHash: input.previousEventHash || null,
  };
  if (!payload.eventType || !['human','system','assistant'].includes(payload.actorType)) throw new Error('invalid audit event');
  const eventHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, eventHash };
}
module.exports = { buildAuditEvent };
