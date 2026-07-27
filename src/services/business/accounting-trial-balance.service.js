function normalizePeriod(label, period = {}) {
  if (!period.startDate || !period.endDate) {
    throw Object.assign(new Error(`Les dates de la ${label} sont obligatoires.`), { status: 400 });
  }
  if (period.startDate > period.endDate) {
    throw Object.assign(new Error(`La date de début de la ${label} doit précéder sa date de fin.`), { status: 400 });
  }
  return { startDate: period.startDate, endDate: period.endDate };
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function loadPeriodRows(db, organisationId, period) {
  const { rows } = await db.query(
    `SELECT a.id AS account_id,
            a.code,
            a.name,
            a.account_type,
            a.is_active,
            COALESCE(SUM(l.debit), 0)::numeric AS debit,
            COALESCE(SUM(l.credit), 0)::numeric AS credit,
            COALESCE(SUM(l.debit - l.credit), 0)::numeric AS balance
     FROM accounting_accounts a
     LEFT JOIN accounting_entry_lines l
       ON l.account_id = a.id
      AND l.organisation_id = a.organisation_id
     LEFT JOIN accounting_entries e
       ON e.id = l.entry_id
      AND e.organisation_id = l.organisation_id
      AND e.status IN ('posted', 'reversed')
      AND e.entry_date >= $2::date
      AND e.entry_date <= $3::date
     WHERE a.organisation_id = $1
     GROUP BY a.id
     ORDER BY a.code`,
    [organisationId, period.startDate, period.endDate],
  );
  return rows;
}

async function loadAnomalies(db, organisationId, current) {
  const { rows } = await db.query(
    `WITH entry_totals AS (
       SELECT e.id,
              e.entry_number,
              e.entry_date,
              e.source_type,
              e.source_id,
              COALESCE(SUM(l.debit), 0)::numeric AS debit,
              COALESCE(SUM(l.credit), 0)::numeric AS credit,
              BOOL_OR(a.is_active = FALSE) AS uses_inactive_account
       FROM accounting_entries e
       JOIN accounting_entry_lines l
         ON l.entry_id = e.id
        AND l.organisation_id = e.organisation_id
       JOIN accounting_accounts a
         ON a.id = l.account_id
        AND a.organisation_id = l.organisation_id
       WHERE e.organisation_id = $1
         AND e.status IN ('posted', 'reversed')
         AND e.entry_date >= $2::date
         AND e.entry_date <= $3::date
       GROUP BY e.id
     )
     SELECT id AS entry_id,
            entry_number,
            entry_date,
            source_type,
            source_id,
            debit,
            credit,
            uses_inactive_account,
            CASE
              WHEN debit <> credit THEN 'unbalanced_entry'
              WHEN uses_inactive_account THEN 'inactive_account_used'
            END AS anomaly_type
     FROM entry_totals
     WHERE debit <> credit OR uses_inactive_account
     ORDER BY entry_date, id`,
    [organisationId, current.startDate, current.endDate],
  );
  return rows;
}

function indexRows(rows) {
  return new Map(rows.map((row) => [String(row.account_id), row]));
}

function buildComparativeRows(currentRows, previousRows) {
  const current = indexRows(currentRows);
  const previous = indexRows(previousRows);
  const ids = new Set([...current.keys(), ...previous.keys()]);

  return Array.from(ids).map((id) => {
    const currentRow = current.get(id);
    const previousRow = previous.get(id);
    const source = currentRow || previousRow;
    const currentDebit = money(currentRow?.debit);
    const currentCredit = money(currentRow?.credit);
    const currentBalance = money(currentRow?.balance);
    const previousDebit = money(previousRow?.debit);
    const previousCredit = money(previousRow?.credit);
    const previousBalance = money(previousRow?.balance);

    return {
      accountId: Number(id),
      code: source.code,
      name: source.name,
      accountType: source.account_type,
      isActive: source.is_active !== false,
      current: { debit: currentDebit, credit: currentCredit, balance: currentBalance },
      previous: { debit: previousDebit, credit: previousCredit, balance: previousBalance },
      variance: {
        debit: money(currentDebit - previousDebit),
        credit: money(currentCredit - previousCredit),
        balance: money(currentBalance - previousBalance),
      },
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
}

function totals(rows) {
  return rows.reduce((result, row) => ({
    debit: money(result.debit + row.current.debit),
    credit: money(result.credit + row.current.credit),
    balance: money(result.balance + row.current.balance),
  }), { debit: 0, credit: 0, balance: 0 });
}

async function getComparativeTrialBalance(db, organisationId, input = {}) {
  const current = normalizePeriod("période courante", input.current);
  const previous = normalizePeriod("période précédente", input.previous);
  const [currentRows, previousRows, anomalies] = await Promise.all([
    loadPeriodRows(db, organisationId, current),
    loadPeriodRows(db, organisationId, previous),
    loadAnomalies(db, organisationId, current),
  ]);
  const rows = buildComparativeRows(currentRows, previousRows);
  const summary = totals(rows);

  return {
    periods: { current, previous },
    rows,
    totals: summary,
    isBalanced: summary.debit === summary.credit,
    anomalies: anomalies.map((row) => ({
      type: row.anomaly_type,
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      entryDate: row.entry_date,
      source: { type: row.source_type, id: row.source_id },
      debit: money(row.debit),
      credit: money(row.credit),
      difference: money(Number(row.debit) - Number(row.credit)),
    })),
  };
}

module.exports = {
  normalizePeriod,
  buildComparativeRows,
  totals,
  getComparativeTrialBalance,
};
