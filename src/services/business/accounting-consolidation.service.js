function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateNetConsolidatedTotal({ memberTotals = [], eliminations = [] }) {
  const gross = toMoney(memberTotals.reduce((sum, value) => sum + Number(value || 0), 0));
  const eliminated = toMoney(eliminations.reduce((sum, value) => sum + Number(value || 0), 0));
  return { gross, eliminated, net: toMoney(gross - eliminated) };
}

async function createRun(db, organisationId, userId, payload) {
  const totals = calculateNetConsolidatedTotal(payload);
  const { rows } = await db.query(
    `INSERT INTO accounting_consolidation_runs
      (organisation_id,group_id,period_end,status,exchange_rates,totals,elimination_totals,evidence,idempotency_key,created_by)
     VALUES ($1,$2,$3,'calculated',$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organisation_id,idempotency_key)
     DO UPDATE SET idempotency_key=accounting_consolidation_runs.idempotency_key
     RETURNING *`,
    [organisationId, payload.groupId, payload.periodEnd, payload.exchangeRates || {},
      totals, { eliminated: totals.eliminated }, payload.evidence || [], payload.idempotencyKey, userId || null],
  );
  return rows[0];
}

module.exports = { calculateNetConsolidatedTotal, createRun };
