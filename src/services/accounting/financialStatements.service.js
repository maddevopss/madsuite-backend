function signedBalance(row) {
  const debit = Number(row.debit || 0);
  const credit = Number(row.credit || 0);
  return ['liability', 'equity', 'revenue'].includes(row.account_type) ? credit - debit : debit - credit;
}

function buildFinancialStatements(rows) {
  const totals = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
  rows.forEach((row) => { totals[row.account_type] += signedBalance(row); });
  const netIncome = Math.round((totals.revenue - totals.expense) * 100) / 100;
  return {
    incomeStatement: { revenue: totals.revenue, expense: totals.expense, netIncome },
    balanceSheet: {
      assets: totals.asset,
      liabilities: totals.liability,
      equity: Math.round((totals.equity + netIncome) * 100) / 100,
      balanced: Math.round(totals.asset * 100) === Math.round((totals.liability + totals.equity + netIncome) * 100),
    },
  };
}

module.exports = { signedBalance, buildFinancialStatements };
