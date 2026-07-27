function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateVariance({ budget, actual }) {
  const budgetAmount = toMoney(budget || 0);
  const actualAmount = toMoney(actual || 0);
  const variance = toMoney(actualAmount - budgetAmount);
  const variancePercent = budgetAmount === 0 ? null : toMoney((variance / Math.abs(budgetAmount)) * 100);
  return { budget: budgetAmount, actual: actualAmount, variance, variancePercent };
}

async function getBudgetVariance(db, organisationId, budgetId) {
  const { rows } = await db.query(
    `SELECT bl.account_id, bl.cost_center_id, bl.period_number,
            SUM(bl.amount)::numeric AS budget,
            COALESCE(SUM(CASE WHEN el.debit > 0 THEN el.debit ELSE -el.credit END),0)::numeric AS actual
       FROM accounting_budget_lines bl
       LEFT JOIN accounting_entry_lines el
         ON el.organisation_id=bl.organisation_id
        AND el.account_id=bl.account_id
        AND el.cost_center_id IS NOT DISTINCT FROM bl.cost_center_id
       LEFT JOIN accounting_entries e ON e.id=el.entry_id AND e.organisation_id=el.organisation_id AND e.status='posted'
      WHERE bl.organisation_id=$1 AND bl.budget_id=$2
      GROUP BY bl.account_id, bl.cost_center_id, bl.period_number
      ORDER BY bl.account_id, bl.cost_center_id, bl.period_number`,
    [organisationId, budgetId],
  );
  return rows.map((row) => ({ ...row, ...calculateVariance(row) }));
}

module.exports = { calculateVariance, getBudgetVariance };
