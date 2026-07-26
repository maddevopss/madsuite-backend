function assessCapability({ useCaseId, metrics, thresholds }) {
  if (!useCaseId || !metrics || !thresholds) throw new Error('ai.monitor.input_required');
  const breaches = [];
  if (metrics.acceptanceRate < thresholds.minAcceptanceRate) breaches.push('acceptance');
  if (metrics.correctionRate > thresholds.maxCorrectionRate) breaches.push('correction');
  if (metrics.refusalRate < thresholds.minRefusalRate) breaches.push('refusal');
  if (metrics.driftScore > thresholds.maxDriftScore) breaches.push('drift');
  if (metrics.p95LatencyMs > thresholds.maxP95LatencyMs) breaches.push('latency');
  if (metrics.costCad > thresholds.maxCostCad) breaches.push('cost');
  const state = breaches.length === 0 ? 'enabled' : breaches.length === 1 ? 'degraded' : 'stopped';
  return Object.freeze({ contract: 'assisted-capability-monitor@1', useCaseId, state, breaches, executionAllowed: state === 'enabled' });
}

function assertCapabilityEnabled(report) {
  if (report?.executionAllowed !== true) throw new Error('ai.capability.controlled_stop');
  return true;
}

module.exports = { assessCapability, assertCapabilityEnabled };
