function number(value) {
  return Number(value || 0);
}

function summarize(rows = []) {
  const normalized = rows.map((row) => ({
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceAmount: number(row.source_amount),
    postedDebit: number(row.posted_debit),
    postedCredit: number(row.posted_credit),
    entryCount: number(row.entry_count),
  }));

  const anomalies = normalized.filter((row) => (
    row.entryCount !== 1
    || Math.abs(row.postedDebit - row.postedCredit) > 0.005
    || Math.abs(row.sourceAmount - row.postedDebit) > 0.005
  ));

  return {
    checked: normalized.length,
    balanced: normalized.length - anomalies.length,
    anomalies,
    healthy: anomalies.length === 0,
  };
}

async function reconcilePostedSources(db, organisationId) {
  const { rows } = await db.query(
    `SELECT e.source_type, e.source_id,
            COALESCE(MAX(le.amount), 0)::numeric AS source_amount,
            COALESCE(SUM(l.debit), 0)::numeric AS posted_debit,
            COALESCE(SUM(l.credit), 0)::numeric AS posted_credit,
            COUNT(DISTINCT e.id)::integer AS entry_count
     FROM accounting_entries e
     JOIN accounting_entry_lines l
       ON l.entry_id = e.id AND l.organisation_id = e.organisation_id
     LEFT JOIN ledger_entries le
       ON le.organisation_id = e.organisation_id
      AND le.source_type = e.source_type
      AND le.source_id::text = e.source_id::text
     WHERE e.organisation_id = $1
       AND e.status IN ('posted','reversed')
       AND e.source_type IS NOT NULL
       AND e.source_id IS NOT NULL
     GROUP BY e.source_type, e.source_id
     ORDER BY e.source_type, e.source_id`,
    [organisationId],
  );

  return summarize(rows);
}

module.exports = { summarize, reconcilePostedSources };
