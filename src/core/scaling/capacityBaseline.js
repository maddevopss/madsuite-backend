'use strict';

const REQUIRED_METRICS = ['volume', 'throughput', 'payloadBytes', 'processingMs'];

function buildCapacityBaseline(samples = []) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('capacity_samples_required');
  }
  for (const sample of samples) {
    for (const metric of REQUIRED_METRICS) {
      if (!Number.isFinite(sample[metric]) || sample[metric] < 0) {
        throw new Error(`invalid_capacity_metric:${metric}`);
      }
    }
  }
  const max = metric => Math.max(...samples.map(sample => sample[metric]));
  const average = metric => samples.reduce((sum, sample) => sum + sample[metric], 0) / samples.length;
  return {
    contract: 'capacity-baseline@1',
    sampleCount: samples.length,
    maxima: Object.fromEntries(REQUIRED_METRICS.map(metric => [metric, max(metric)])),
    averages: Object.fromEntries(REQUIRED_METRICS.map(metric => [metric, average(metric)])),
    saturationThresholds: {
      throughput: max('throughput') * 0.85,
      processingMs: max('processingMs') * 0.9,
    },
  };
}

module.exports = { buildCapacityBaseline, REQUIRED_METRICS };
