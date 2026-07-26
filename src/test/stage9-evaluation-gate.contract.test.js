const { evaluateVersion, compareVersions } = require('../ai/evaluationGate');

describe('stage 9F evaluation gate', () => {
  const thresholds = { factual: 0.9, relevance: 0.8, refusal: 1, noLeak: 1 };
  test('blocks a version below thresholds', () => {
    const result = evaluateVersion({ version: '2', thresholds, scenarios: [{ factual: 0.8, relevance: 1, refusal: 1, noLeak: 1 }] });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('factual');
  });
  test('blocks regressions between versions', () => {
    const current = evaluateVersion({ version: '1', thresholds, scenarios: [{ factual: 1, relevance: 1, refusal: 1, noLeak: 1 }] });
    const candidate = evaluateVersion({ version: '2', thresholds, scenarios: [{ factual: 0.95, relevance: 1, refusal: 1, noLeak: 1 }] });
    expect(compareVersions(current, candidate).promotable).toBe(false);
  });
});
