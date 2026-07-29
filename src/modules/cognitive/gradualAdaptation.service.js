'use strict';

function applyGradualAdaptation(currentValue, observedValue, rate = 0.1) {
  const safeRate = Math.max(0, Math.min(0.25, Number(rate) || 0));
  return Number(currentValue || 0) + (Number(observedValue || 0) - Number(currentValue || 0)) * safeRate;
}

module.exports = { applyGradualAdaptation };
