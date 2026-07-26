'use strict';

function assessGovernanceMetrics({ assetId, volume, qualityScore, monthlyCost, accessIncidents, classificationDrift, retentionDrift, usageDrift, thresholds, owner }) {
  if (!assetId || !owner || !thresholds) throw new Error('assetId, owner and thresholds are required');
  const alerts = [];
  if (qualityScore < thresholds.minimumQualityScore) alerts.push('quality');
  if (monthlyCost > thresholds.maximumMonthlyCost) alerts.push('cost');
  if (accessIncidents > thresholds.maximumAccessIncidents) alerts.push('access');
  if (classificationDrift) alerts.push('classification_drift');
  if (retentionDrift) alerts.push('retention_drift');
  if (usageDrift) alerts.push('usage_drift');
  return Object.freeze({ assetId, owner, volume, qualityScore, monthlyCost, accessIncidents, alerts, requiresDecision: alerts.length > 0 });
}

module.exports = { assessGovernanceMetrics };
