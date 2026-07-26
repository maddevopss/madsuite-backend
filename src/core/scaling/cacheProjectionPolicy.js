'use strict';

function validateCacheProjection(policy = {}) {
  const required = ['name', 'source', 'ttlSeconds', 'invalidationEvents', 'rebuildStrategy'];
  for (const field of required) if (policy[field] === undefined || policy[field] === null) throw new Error(`cache_policy_field_required:${field}`);
  if (!Number.isInteger(policy.ttlSeconds) || policy.ttlSeconds <= 0) throw new Error('invalid_cache_ttl');
  if (!Array.isArray(policy.invalidationEvents) || policy.invalidationEvents.length === 0) throw new Error('invalidation_events_required');
  if (!['replay-events', 'query-source', 'snapshot-plus-events'].includes(policy.rebuildStrategy)) throw new Error('projection_not_rebuildable');
  if (policy.sensitiveDecision === true && policy.staleAllowed === true) throw new Error('stale_sensitive_decision_forbidden');
  return { contract: 'cache-projection-policy@1', valid: true, freshnessMustBeExposed: true };
}

module.exports = { validateCacheProjection };
