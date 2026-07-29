function buildTrialBalance(rows) {
  const accounts = rows.map((row) => ({
    accountId: row.account_id,
    code: row.code,
    name: row.name,
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
  }));
  const totalDebit = accounts.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = accounts.reduce((sum, row) => sum + row.credit, 0);
  return {
    accounts,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    balanced: Math.round(totalDebit * 100) === Math.round(totalCredit * 100),
  };
}

async function getTrialBalance(client, organisationId, endDate) {
  const { rows } = await client.query(
    `SELECT a.id AS account_id, a.code, a.name,
            SUM(l.debit) AS debit, SUM(l.credit) AS credit
       FROM accounting_accounts a
       LEFT JOIN accounting_journal_lines l ON l.account_id = a.id AND l.organisation_id = a.organisation_id
       LEFT JOIN accounting_journal_entries e ON e.id = l.entry_id AND e.organisation_id = a.organisation_id
      WHERE a.organisation_id = $1 AND (e.id IS NULL OR (e.status = 'posted' AND e.entry_date <= $2::date))
      GROUP BY a.id, a.code, a.name
      ORDER BY a.code`,
    [organisationId, endDate],
  );
  return buildTrialBalance(rows);
}

module.exports = { buildTrialBalance, getTrialBalance };
