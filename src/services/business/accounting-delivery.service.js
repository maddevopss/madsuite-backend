const accountingService = require("./accounting.service");

const REQUIRED_ACCOUNT_CODES = ["1010", "1100", "1300", "2000", "2100", "2200", "4000", "6000", "6900"];

function amount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
}

async function getReadiness(db, organisationId, asOf = null) {
  const [accounts, periods, drafts, unbalanced] = await Promise.all([
    db.query(
      `SELECT code FROM accounting_accounts
       WHERE organisation_id = $1 AND is_active = TRUE AND code = ANY($2::varchar[])`,
      [organisationId, REQUIRED_ACCOUNT_CODES],
    ),
    db.query(
      `SELECT id, fiscal_year, period_number, starts_on, ends_on, status
       FROM accounting_periods
       WHERE organisation_id = $1
         AND ($2::date IS NULL OR $2::date BETWEEN starts_on AND ends_on)
       ORDER BY starts_on DESC`,
      [organisationId, asOf],
    ),
    db.query(
      `SELECT COUNT(*)::integer AS count
       FROM accounting_entries
       WHERE organisation_id = $1 AND status = 'draft'`,
      [organisationId],
    ),
    db.query(
      `SELECT COUNT(*)::integer AS count
       FROM (
         SELECT e.id
         FROM accounting_entries e
         JOIN accounting_entry_lines l
           ON l.entry_id = e.id AND l.organisation_id = e.organisation_id
         WHERE e.organisation_id = $1 AND e.status IN ('posted','reversed')
         GROUP BY e.id
         HAVING ROUND(SUM(l.debit)::numeric, 2) <> ROUND(SUM(l.credit)::numeric, 2)
       ) anomalies`,
      [organisationId],
    ),
  ]);

  const existingCodes = new Set(accounts.rows.map((row) => row.code));
  const missingAccounts = REQUIRED_ACCOUNT_CODES.filter((code) => !existingCodes.has(code));
  const relevantPeriods = periods.rows;
  const openPeriod = relevantPeriods.find((period) => period.status === "open") || null;
  const overlappingPeriods = relevantPeriods.length > 1;
  const draftCount = Number(drafts.rows[0]?.count || 0);
  const unbalancedPostedCount = Number(unbalanced.rows[0]?.count || 0);

  const blockers = [];
  if (missingAccounts.length) blockers.push({ code: "MISSING_ACCOUNTS", details: missingAccounts });
  if (!openPeriod) blockers.push({ code: "NO_OPEN_PERIOD" });
  if (overlappingPeriods) blockers.push({ code: "OVERLAPPING_PERIODS" });
  if (unbalancedPostedCount > 0) blockers.push({ code: "UNBALANCED_POSTED_ENTRIES", count: unbalancedPostedCount });

  return {
    ready: blockers.length === 0,
    asOf,
    requiredAccounts: REQUIRED_ACCOUNT_CODES,
    missingAccounts,
    openPeriod,
    overlappingPeriods,
    draftCount,
    unbalancedPostedCount,
    blockers,
  };
}

function indexByCode(rows) {
  return new Map(rows.map((row) => [row.code, row]));
}

async function comparativeTrialBalance(db, organisationId, current, previous) {
  if (!current?.startDate || !current?.endDate || !previous?.startDate || !previous?.endDate) {
    throw Object.assign(new Error("Les deux périodes comparatives sont obligatoires."), { status: 400 });
  }

  const [currentRows, previousRows] = await Promise.all([
    accountingService.trialBalance(db, organisationId, current.startDate, current.endDate),
    accountingService.trialBalance(db, organisationId, previous.startDate, previous.endDate),
  ]);
  const currentByCode = indexByCode(currentRows);
  const previousByCode = indexByCode(previousRows);
  const codes = [...new Set([...currentByCode.keys(), ...previousByCode.keys()])].sort();

  const rows = codes.map((code) => {
    const currentRow = currentByCode.get(code) || {};
    const previousRow = previousByCode.get(code) || {};
    const currentBalance = amount(currentRow.balance);
    const previousBalance = amount(previousRow.balance);
    return {
      code,
      name: currentRow.name || previousRow.name || "",
      accountType: currentRow.account_type || previousRow.account_type || null,
      current: {
        debit: amount(currentRow.debit),
        credit: amount(currentRow.credit),
        balance: currentBalance,
      },
      previous: {
        debit: amount(previousRow.debit),
        credit: amount(previousRow.credit),
        balance: previousBalance,
      },
      variance: amount(currentBalance - previousBalance),
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.currentDebit = amount(acc.currentDebit + row.current.debit);
    acc.currentCredit = amount(acc.currentCredit + row.current.credit);
    acc.previousDebit = amount(acc.previousDebit + row.previous.debit);
    acc.previousCredit = amount(acc.previousCredit + row.previous.credit);
    return acc;
  }, { currentDebit: 0, currentCredit: 0, previousDebit: 0, previousCredit: 0 });

  return {
    current,
    previous,
    rows,
    totals,
    currentBalanced: totals.currentDebit === totals.currentCredit,
    previousBalanced: totals.previousDebit === totals.previousCredit,
  };
}

async function traceSource(db, organisationId, sourceType, sourceId) {
  const { rows } = await db.query(
    `SELECT e.id, e.entry_number, e.entry_date, e.description, e.status,
            e.source_type, e.source_id, j.code AS journal_code,
            COALESCE(SUM(l.debit), 0)::numeric AS debit,
            COALESCE(SUM(l.credit), 0)::numeric AS credit
     FROM accounting_entries e
     JOIN accounting_journals j ON j.id = e.journal_id AND j.organisation_id = e.organisation_id
     LEFT JOIN accounting_entry_lines l ON l.entry_id = e.id AND l.organisation_id = e.organisation_id
     WHERE e.organisation_id = $1 AND e.source_type = $2 AND e.source_id = $3
     GROUP BY e.id, j.code
     ORDER BY e.entry_date, e.id`,
    [organisationId, sourceType, String(sourceId)],
  );

  return rows.map((row) => ({
    ...row,
    debit: amount(row.debit),
    credit: amount(row.credit),
    balanced: amount(row.debit) === amount(row.credit),
  }));
}

module.exports = {
  REQUIRED_ACCOUNT_CODES,
  amount,
  getReadiness,
  comparativeTrialBalance,
  traceSource,
};
