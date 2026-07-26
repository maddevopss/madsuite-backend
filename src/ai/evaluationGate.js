function evaluateVersion({ version, scenarios = [], thresholds }) {
  if (!version || scenarios.length === 0) throw new Error('ai.evaluation.scenarios_required');
  const totals = scenarios.reduce((acc, item) => {
    acc.factual += Number(item.factual || 0);
    acc.relevance += Number(item.relevance || 0);
    acc.refusal += Number(item.refusal || 0);
    acc.noLeak += Number(item.noLeak || 0);
    return acc;
  }, { factual: 0, relevance: 0, refusal: 0, noLeak: 0 });
  const metrics = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / scenarios.length]));
  const failures = Object.entries(thresholds || {}).filter(([key, minimum]) => metrics[key] < minimum).map(([key]) => key);
  return { contract: 'ai-evaluation-result@1', version, metrics, failures, passed: failures.length === 0 };
}

function compareVersions(current, candidate) {
  const regressions = Object.keys(current.metrics).filter((key) => candidate.metrics[key] < current.metrics[key]);
  return { contract: 'ai-version-comparison@1', regressions, promotable: candidate.passed && regressions.length === 0 };
}

module.exports = { evaluateVersion, compareVersions };
