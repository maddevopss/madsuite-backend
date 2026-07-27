function classifyFinancialHealth(input = {}) {
  const overdue = Number(input.overdueReceivables || 0);
  const receivables = Number(input.receivables || 0);
  const payables = Number(input.payables || 0);
  const revenue = Number(input.revenue || 0);
  const overdueRatio = receivables > 0 ? overdue / receivables : 0;
  const coverage = payables > 0 ? revenue / payables : 2;
  let score = 100 - Math.min(45, Math.round(overdueRatio * 100));
  if (coverage < 1) score -= 30;
  else if (coverage < 1.5) score -= 15;
  score = Math.max(0, Math.min(100, score));
  return { score, status: score >= 75 ? 'healthy' : score >= 50 ? 'watch' : 'critical' };
}
module.exports = { classifyFinancialHealth };
