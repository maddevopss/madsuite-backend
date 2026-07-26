const { evaluateDeployment } = require('../ops/deploymentGate');

describe('stage7 progressive deployment', () => {
  test('allows promotion only after complete validation', () => {
    expect(evaluateDeployment({
      prechecks: [true, true],
      postchecks: [true, true],
      migration: { reversible: false, compensationPlan: 'restore-view-v1' },
      rollback: { tested: true, targetVersion: 'v1' },
    }).promoteAllowed).toBe(true);
  });

  test('requires rollback after failed postchecks', () => {
    expect(evaluateDeployment({
      prechecks: [true],
      postchecks: [false],
      migration: { reversible: true },
      rollback: { tested: true, targetVersion: 'v1' },
    }).rollbackRequired).toBe(true);
  });
});
