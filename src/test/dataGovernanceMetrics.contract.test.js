'use strict';

const { assessGovernanceMetrics } = require('../governance/dataGovernanceMetrics');

describe('data governance metrics', () => {
  test('surfaces drift and requires a decision', () => {
    const result = assessGovernanceMetrics({
      assetId: 'clients', owner: 'operations', volume: 1000, qualityScore: 0.99, monthlyCost: 10,
      accessIncidents: 0, classificationDrift: true, retentionDrift: false, usageDrift: false,
      thresholds: { minimumQualityScore: 0.95, maximumMonthlyCost: 100, maximumAccessIncidents: 0 }
    });
    expect(result).toEqual(expect.objectContaining({ requiresDecision: true, alerts: ['classification_drift'] }));
  });
});
