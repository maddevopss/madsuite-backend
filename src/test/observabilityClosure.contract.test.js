'use strict';
const { evaluateObservabilityClosure, REQUIRED_CONTROLS } = require('../services/business/observability-closure.service');
describe('observability closure contract', () => {
  test('refuses closure when diagnostics are untested', () => {
    const controls = Object.fromEntries(REQUIRED_CONTROLS.map((key) => [key, true]));
    controls.incident_diagnostics_tested = false;
    expect(evaluateObservabilityClosure({ controls, evidence: ['run'], approvedBy: 1 }).closeable).toBe(false);
  });
  test('accepts closure with controls, evidence and approval', () => {
    const controls = Object.fromEntries(REQUIRED_CONTROLS.map((key) => [key, true]));
    expect(evaluateObservabilityClosure({ controls, evidence: ['run'], approvedBy: 1 })).toMatchObject({ closeable: true, status: 'validated' });
  });
});
