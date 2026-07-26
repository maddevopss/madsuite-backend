'use strict';
const { evaluateTechnicalDebt } = require('../core/scaling/technicalDebtRegistry');
describe('technical debt registry', () => {
  it('prioritizes critical debt', () => {
    expect(evaluateTechnicalDebt({ id:'td-1', component:'legacy-route', risk:'critical', owner:'platform', retirementCriteria:'zero consumers' }).priority).toBe(100);
  });
  it('refuses retirement with active consumers', () => {
    expect(() => evaluateTechnicalDebt({ id:'td-2', component:'legacy-field', risk:'high', owner:'platform', retirementCriteria:'zero consumers', retireNow:true, activeConsumerProof:'scan-1', activeConsumers:1 })).toThrow('active_consumers_would_break');
  });
});
