'use strict';
const { validateCacheProjection } = require('../core/scaling/cacheProjectionPolicy');
describe('cache projection policy', () => {
  it('requires rebuildable projections', () => {
    expect(validateCacheProjection({ name:'dashboard', source:'ledger', ttlSeconds:60, invalidationEvents:['ledger.entry.created'], rebuildStrategy:'replay-events' }).valid).toBe(true);
  });
  it('forbids stale data for sensitive decisions', () => {
    expect(() => validateCacheProjection({ name:'approval', source:'budget', ttlSeconds:30, invalidationEvents:['budget.changed'], rebuildStrategy:'query-source', sensitiveDecision:true, staleAllowed:true })).toThrow('stale_sensitive_decision_forbidden');
  });
});
