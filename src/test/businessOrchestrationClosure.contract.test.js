'use strict';

const { evaluateBusinessOrchestrationClosure, REQUIRED_CONTROLS } = require('../services/business/business-orchestration-closure.service');

describe('business orchestration closure contract', () => {
  test('refuses closure when a required control is missing', () => {
    const controls = Object.fromEntries(REQUIRED_CONTROLS.map((key) => [key, true]));
    controls.compensation_tested = false;
    const result = evaluateBusinessOrchestrationClosure({ controls, evidence: ['test-run'], approvedBy: 1 });
    expect(result.closeable).toBe(false);
    expect(result.blockers.some((blocker) => blocker.code === 'compensation_tested')).toBe(true);
  });

  test('accepts closure only with all controls, evidence and human approval', () => {
    const controls = Object.fromEntries(REQUIRED_CONTROLS.map((key) => [key, true]));
    expect(evaluateBusinessOrchestrationClosure({ controls, evidence: ['contract-suite'], approvedBy: 1 })).toMatchObject({ closeable: true, status: 'validated' });
  });
});
