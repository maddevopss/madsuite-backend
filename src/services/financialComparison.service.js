'use strict';

function comparePeriods(current = {}, previous = {}) {
  const keys = [...new Set([...Object.keys(current), ...Object.keys(previous)])];
  return Object.fromEntries(keys.map((key) => {
    const currentValue = current[key] || 0;
    const previousValue = previous[key] || 0;
    const variance = currentValue - previousValue;
    const varianceRate = previousValue === 0 ? null : variance / Math.abs(previousValue);
    return [key, { current: currentValue, previous: previousValue, variance, varianceRate }];
  }));
}

function flagMaterialVariances(comparison, thresholdRate = 0.1, thresholdCents = 10000) {
  return Object.entries(comparison).filter(([, row]) =>
    Math.abs(row.variance) >= thresholdCents
    && (row.varianceRate === null || Math.abs(row.varianceRate) >= thresholdRate))
    .map(([key, row]) => ({ key, ...row }));
}

module.exports = { comparePeriods, flagMaterialVariances };
