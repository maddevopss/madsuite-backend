'use strict';
const { evaluateStage11Closure } = require('../core/scaling/stage11Closure');
describe('stage 11 closure', () => {
  it('closes only with all proofs, limits and accepted risks', () => {
    const report = evaluateStage11Closure({
      capacityLoadTest:true,
      progressiveScaleTest:true,
      projectionRebuild:true,
      versionMigrationSimulation:true,
      dataSovereigntyReview:true,
      consumerRetirementScan:true,
      knownLimits:['single-region write authority'],
      residualRisks:[{ owner:'platform', decision:'accepted', reviewDate:'2026-10-01' }],
      nextArchitectureDecisions:['evaluate regional read replicas'],
    });
    expect(report.closed).toBe(true);
  });
  it('keeps the stage open when a proof is missing', () => {
    expect(evaluateStage11Closure({ knownLimits:['limit'], residualRisks:[] }).closed).toBe(false);
  });
});
