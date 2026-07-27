function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizePeriod(label, period = {}) {
  if (!period.startDate || !period.endDate) {
    throw Object.assign(new Error(`Les dates de la ${label} sont obligatoires.`), { status: 400 });
  }
  if (period.startDate > period.endDate) {
    throw Object.assign(new Error(`La date de début de la ${label} doit précéder sa date de fin.`), { status: 400 });
  }
  return { startDate: period.startDate, endDate: period.endDate };
}

async function loadStatementRows(db, organisationId, period) {
  const { rows } = await db.query(
    `SELECT a.id AS account_id,
            a.code,
            a.name,
            a.account_type,
            e.id AS entry_id,
            e.entry_number,
            e.entry_date,
            e.source_type,
            e.source_id,
            l.id AS line_id,
            l.debit::numeric,
            l.credit::numeric
     FROM accounting_entry_lines l
     JOIN accounting_entries e
       ON e.id = l.entry_id
      AND e.organisation_id = l.organisation_id
     JOIN accounting_accounts a
       ON a.id = l.account_id
      AND a.organisation_id = l.organisation_id
     WHERE l.organisation_id = $1
       AND e.status IN ('posted', 'reversed')
       AND e.entry_date >= $2::date
       AND e.entry_date <= $3::date
     ORDER BY a.code, e.entry_date, e.id, l.id`,
    [organisationId, period.startDate, period.endDate],
  );
  return rows;
}

function groupAccounts(rows) {
  const accounts = new Map();
  for (const row of rows) {
    const id = String(row.account_id);
    if (!accounts.has(id)) {
      accounts.set(id, {
        accountId: Number(row.account_id),
        code: row.code,
        name: row.name,
        accountType: row.account_type,
        debit: 0,
        credit: 0,
        balance: 0,
        sources: [],
      });
    }
    const account = accounts.get(id);
    const debit = money(row.debit);
    const credit = money(row.credit);
    account.debit = money(account.debit + debit);
    account.credit = money(account.credit + credit);
    account.balance = money(account.balance + debit - credit);
    account.sources.push({
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      entryDate: row.entry_date,
      lineId: row.line_id,
      source: { type: row.source_type, id: row.source_id },
      debit,
      credit,
    });
  }
  return Array.from(accounts.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function totalByTypes(accounts, types) {
  return money(accounts
    .filter((account) => types.includes(account.accountType))
    .reduce((sum, account) => sum + account.balance, 0));
}

function buildStatements(accounts) {
  const revenueAccounts = accounts.filter((account) => account.accountType === "revenue");
  const expenseAccounts = accounts.filter((account) => account.accountType === "expense");
  const assetAccounts = accounts.filter((account) => account.accountType === "asset");
  const liabilityAccounts = accounts.filter((account) => account.accountType === "liability");
  const equityAccounts = accounts.filter((account) => account.accountType === "equity");

  const revenue = money(-totalByTypes(accounts, ["revenue"]));
  const expenses = money(totalByTypes(accounts, ["expense"]));
  const assets = money(totalByTypes(accounts, ["asset"]));
  const liabilities = money(-totalByTypes(accounts, ["liability"]));
  const equity = money(-totalByTypes(accounts, ["equity"]));

  const cashAccounts = assetAccounts.filter((account) => /cash|bank|banque|caisse/i.test(`${account.code} ${account.name}`));
  const operatingAccounts = accounts.filter((account) => ["revenue", "expense"].includes(account.accountType));
  const investingAccounts = assetAccounts.filter((account) => !cashAccounts.includes(account));
  const financingAccounts = accounts.filter((account) => ["liability", "equity"].includes(account.accountType));

  return {
    incomeStatement: {
      revenue,
      expenses,
      netIncome: money(revenue - expenses),
      accounts: [...revenueAccounts, ...expenseAccounts],
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      retainedEarnings: money(revenue - expenses),
      isBalanced: money(assets - liabilities - equity - (revenue - expenses)) === 0,
      accounts: [...assetAccounts, ...liabilityAccounts, ...equityAccounts],
    },
    cashFlow: {
      operating: money(operatingAccounts.reduce((sum, account) => sum - account.balance, 0)),
      investing: money(investingAccounts.reduce((sum, account) => sum - account.balance, 0)),
      financing: money(financingAccounts.reduce((sum, account) => sum - account.balance, 0)),
      netChange: money(cashAccounts.reduce((sum, account) => sum + account.balance, 0)),
      accounts: { cash: cashAccounts, operating: operatingAccounts, investing: investingAccounts, financing: financingAccounts },
    },
  };
}

function comparativeAmount(current, previous) {
  return { current: money(current), previous: money(previous), variance: money(current - previous) };
}

function buildComparativeStatements(current, previous) {
  return {
    incomeStatement: {
      revenue: comparativeAmount(current.incomeStatement.revenue, previous.incomeStatement.revenue),
      expenses: comparativeAmount(current.incomeStatement.expenses, previous.incomeStatement.expenses),
      netIncome: comparativeAmount(current.incomeStatement.netIncome, previous.incomeStatement.netIncome),
      accounts: current.incomeStatement.accounts,
      previousAccounts: previous.incomeStatement.accounts,
    },
    balanceSheet: {
      assets: comparativeAmount(current.balanceSheet.assets, previous.balanceSheet.assets),
      liabilities: comparativeAmount(current.balanceSheet.liabilities, previous.balanceSheet.liabilities),
      equity: comparativeAmount(current.balanceSheet.equity, previous.balanceSheet.equity),
      retainedEarnings: comparativeAmount(current.balanceSheet.retainedEarnings, previous.balanceSheet.retainedEarnings),
      isBalanced: current.balanceSheet.isBalanced,
      accounts: current.balanceSheet.accounts,
      previousAccounts: previous.balanceSheet.accounts,
    },
    cashFlow: {
      operating: comparativeAmount(current.cashFlow.operating, previous.cashFlow.operating),
      investing: comparativeAmount(current.cashFlow.investing, previous.cashFlow.investing),
      financing: comparativeAmount(current.cashFlow.financing, previous.cashFlow.financing),
      netChange: comparativeAmount(current.cashFlow.netChange, previous.cashFlow.netChange),
      accounts: current.cashFlow.accounts,
      previousAccounts: previous.cashFlow.accounts,
    },
  };
}

async function getComparativeStatements(db, organisationId, input = {}) {
  const currentPeriod = normalizePeriod("période courante", input.current);
  const previousPeriod = normalizePeriod("période précédente", input.previous);
  const [currentRows, previousRows] = await Promise.all([
    loadStatementRows(db, organisationId, currentPeriod),
    loadStatementRows(db, organisationId, previousPeriod),
  ]);
  const current = buildStatements(groupAccounts(currentRows));
  const previous = buildStatements(groupAccounts(previousRows));
  return {
    periods: { current: currentPeriod, previous: previousPeriod },
    statements: buildComparativeStatements(current, previous),
  };
}

module.exports = {
  money,
  normalizePeriod,
  groupAccounts,
  buildStatements,
  buildComparativeStatements,
  getComparativeStatements,
};
