'use strict';

function buildFinancialDashboard({ incomeStatement, balanceSheet, cashFlow, receivablesAging, payablesSchedule, ratios }) {
  const overdueReceivablesCents = Object.entries(receivablesAging?.totals || {})
    .filter(([bucket]) => bucket !== 'current')
    .reduce((sum, [, value]) => sum + value, 0);
  const dueSoonPayablesCents = (payablesSchedule || [])
    .filter((item) => item.urgency === 'due_soon' || item.urgency === 'overdue')
    .reduce((sum, item) => sum + item.balanceCents, 0);
  return {
    revenueCents: incomeStatement?.revenueCents || 0,
    expenseCents: incomeStatement?.expenseCents || 0,
    netIncomeCents: incomeStatement?.netIncomeCents || 0,
    cashNetChangeCents: cashFlow?.netChangeCents || 0,
    assetsCents: balanceSheet?.assetsCents || 0,
    liabilitiesCents: balanceSheet?.liabilitiesCents || 0,
    overdueReceivablesCents,
    dueSoonPayablesCents,
    ratios: ratios || {},
    attentionRequired: overdueReceivablesCents > 0 || dueSoonPayablesCents > 0 || balanceSheet?.balanced === false,
  };
}

module.exports = { buildFinancialDashboard };
