'use strict';

const { evaluateDataQuality, requireQualityForSensitiveDecision } = require('../governance/dataQuality');

const full = { completeness: 1, consistency: 1, uniqueness: 1, validity: 1, freshness: 1 };

describe('data quality governance', () => {
  test('allows quality above thresholds', () => {
    const result = evaluateDataQuality({ assetId: 'ledger', owner: 'finance', scores: full, thresholds: full, sensitiveDecision: true });
    expect(requireQualityForSensitiveDecision(result)).toBe(true);
  });
  test('blocks sensitive decisions on stale data', () => {
    const result = evaluateDataQuality({ assetId: 'ledger', owner: 'finance', scores: { ...full, freshness: 0.4 }, thresholds: full, sensitiveDecision: true });
    expect(() => requireQualityForSensitiveDecision(result)).toThrow(/freshness/);
  });
});
