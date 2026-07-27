function evaluateChangeOrder({ previousTotal = 0, revisedTotal = 0, approvalThreshold = 0 }) {
  const previous = Number(previousTotal);
  const revised = Number(revisedTotal);
  const variance = Number((revised - previous).toFixed(2));
  const variancePercent = previous === 0 ? 100 : Number(((variance / previous) * 100).toFixed(2));
  return { previous, revised, variance, variancePercent, requiresApproval: Math.abs(variance) >= Number(approvalThreshold || 0) };
}
module.exports = { evaluateChangeOrder };