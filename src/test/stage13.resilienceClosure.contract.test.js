'use strict';
const { assessResilienceClosure } = require('../resilience/resilienceClosure');
describe('stage 13H resilience closure', () => {
  test('refuses closure when regional recovery is missing', () => {
    const result = assessResilienceClosure({ componentFailureDetected: true, databaseFailureContained: true, regionalFailureContained: false, backupRestored: true, failoverCompleted: true, failbackCompleted: true, noSilentDataLoss: true, serviceStateCommunicated: true });
    expect(result.closed).toBe(false);
    expect(result.missing).toContain('regionalFailureContained');
  });
  test('closes only with complete evidence', () => {
    const result = assessResilienceClosure({ componentFailureDetected: true, databaseFailureContained: true, regionalFailureContained: true, backupRestored: true, failoverCompleted: true, failbackCompleted: true, noSilentDataLoss: true, serviceStateCommunicated: true, limits: ['provider-wide outage'], residualRisks: ['cross-region cost'] });
    expect(result.closed).toBe(true);
  });
});
