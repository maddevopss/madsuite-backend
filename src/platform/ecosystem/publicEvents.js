'use strict';

function publishPublicEvent(definition, payload) {
  const required = ['name', 'version', 'schema', 'idempotencyKey', 'organisationId'];
  for (const field of required) if (!definition?.[field]) throw new Error(`${field} is required`);
  if (definition.containsSensitiveData === true && definition.explicitSensitiveFields?.length === 0) throw new Error('sensitive fields must be explicit');
  if (!payload || typeof payload !== 'object') throw new Error('event payload is required');
  return Object.freeze({ ...definition, payload, publishedAt: new Date().toISOString() });
}

function authorizeSubscription(subscription) {
  if (!subscription?.partnerId || !subscription?.eventName || !subscription?.organisationId || subscription.approved !== true) throw new Error('approved subscription is required');
  return Object.freeze({ ...subscription, active: true });
}

module.exports = { publishPublicEvent, authorizeSubscription };
