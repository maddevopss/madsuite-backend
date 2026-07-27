const weights = { info: 1, warning: 5, critical: 20 };
function prioritizeAlerts(alerts = []) {
  return [...alerts]
    .map((alert) => ({ ...alert, priority: weights[alert.severity] || 0 }))
    .sort((a, b) => b.priority - a.priority || String(a.detectedAt || '').localeCompare(String(b.detectedAt || '')));
}
module.exports = { prioritizeAlerts };
