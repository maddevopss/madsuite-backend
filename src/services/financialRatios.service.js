'use strict';

function safeDivide(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function calculateFinancialRatios({ currentAssetsCents, currentLiabilitiesCents, totalAssetsCents, totalLiabilitiesCents, revenueCents, netIncomeCents, cashCents, receivablesCents }) {
  return {
    currentRatio: safeDivide(currentAssetsCents, currentLiabilitiesCents),
    quickRatio: safeDivide(cashCents + receivablesCents, currentLiabilitiesCents),
    debtRatio: safeDivide(totalLiabilitiesCents, totalAssetsCents),
    netMargin: safeDivide(netIncomeCents, revenueCents),
    returnOnAssets: safeDivide(netIncomeCents, totalAssetsCents),
  };
}

function classifyRatio(value, thresholds) {
  if (value === null) return 'unavailable';
  if (value >= thresholds.healthy) return 'healthy';
  if (value >= thresholds.watch) return 'watch';
  return 'risk';
}

module.exports = { calculateFinancialRatios, classifyRatio, safeDivide };
