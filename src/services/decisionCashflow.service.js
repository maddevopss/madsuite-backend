function buildCashflowForecast({ openingCash = 0, inflows = [], outflows = [] } = {}) {
  const expectedInflows = inflows.reduce((sum, value) => sum + Number(value || 0), 0);
  const expectedOutflows = outflows.reduce((sum, value) => sum + Number(value || 0), 0);
  const projectedClosingCash = Number(openingCash) + expectedInflows - expectedOutflows;
  const riskStatus = projectedClosingCash < 0 ? 'shortfall' : projectedClosingCash < expectedOutflows * 0.15 ? 'watch' : 'stable';
  return { expectedInflows, expectedOutflows, projectedClosingCash, riskStatus };
}
module.exports = { buildCashflowForecast };
