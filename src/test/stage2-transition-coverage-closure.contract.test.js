const { failures, inspectStage2TransitionCoverage, stage2Transitions } = require('../../scripts/guard-stage2-transition-coverage');

describe('stage 2 transition coverage closure', () => {
  test('keeps every explicit institutional transition registered, routed and tested', () => {
    expect(failures()).toEqual([]);
  });

  test('covers the issue 170 transition block without client-only shortcuts', () => {
    const report = inspectStage2TransitionCoverage();
    expect(report.map((item) => item.policy).sort()).toEqual(stage2Transitions.map((item) => item.policy).sort());
    expect(report).toHaveLength(18);
  });
});
