function runningBalance(lines, normalBalance) {
  let balance = 0;
  return lines.map((line) => {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    balance += normalBalance === 'credit' ? credit - debit : debit - credit;
    return { ...line, balance: Math.round(balance * 100) / 100 };
  });
}

async function getGeneralLedger(client, organisationId, accountId, { startDate, endDate } = {}) {
  const { rows } = await client.query(
    `SELECT a.code, a.name, a.normal_balance, e.entry_date, e.memo,
            e.reference_type, e.reference_id, l.description, l.debit, l.credit
       FROM accounting_journal_lines l
       JOIN accounting_journal_entries e ON e.id = l.entry_id AND e.organisation_id = l.organisation_id
       JOIN accounting_accounts a ON a.id = l.account_id AND a.organisation_id = l.organisation_id
      WHERE l.organisation_id = $1 AND l.account_id = $2
        AND e.status = 'posted'
        AND ($3::date IS NULL OR e.entry_date >= $3::date)
        AND ($4::date IS NULL OR e.entry_date <= $4::date)
      ORDER BY e.entry_date, e.id, l.id`,
    [organisationId, accountId, startDate || null, endDate || null],
  );
  const normalBalance = rows[0]?.normal_balance || 'debit';
  return runningBalance(rows, normalBalance);
}

module.exports = { runningBalance, getGeneralLedger };
