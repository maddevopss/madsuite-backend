const crypto = require('crypto');

function stableHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function saveSnapshot(db, organisationId, userId, input) {
  const sourceHash = stableHash({
    statementType: input.statementType,
    asOfDate: input.asOfDate,
    payload: input.payload,
    totals: input.totals || {},
  });
  const { rows } = await db.query(
    `INSERT INTO accounting_statement_snapshots
      (organisation_id,period_id,statement_type,as_of_date,comparison_start,comparison_end,currency,payload,totals,source_hash,generated_by,locked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $12 THEN NOW() ELSE NULL END)
     ON CONFLICT (organisation_id,statement_type,as_of_date,source_hash)
     DO UPDATE SET generated_at=accounting_statement_snapshots.generated_at
     RETURNING *`,
    [organisationId, input.periodId || null, input.statementType, input.asOfDate,
      input.comparisonStart || null, input.comparisonEnd || null, input.currency || 'CAD',
      input.payload, input.totals || {}, sourceHash, userId || null, Boolean(input.lock)],
  );
  return rows[0];
}

module.exports = { stableHash, saveSnapshot };
