function inspectAccountingIntegrity({ entries = [], lines = [], accounts = [] }) {
  const accountIds = new Set(accounts.map((account) => account.id));
  const linesByEntry = new Map();
  for (const line of lines) {
    if (!linesByEntry.has(line.entry_id)) linesByEntry.set(line.entry_id, []);
    linesByEntry.get(line.entry_id).push(line);
  }

  const issues = [];
  for (const entry of entries) {
    const entryLines = linesByEntry.get(entry.id) || [];
    const debit = entryLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = entryLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (entryLines.length < 2) issues.push({ code: 'ENTRY_TOO_SHORT', entryId: entry.id });
    if (Math.round(debit * 100) !== Math.round(credit * 100)) issues.push({ code: 'ENTRY_UNBALANCED', entryId: entry.id });
    entryLines.forEach((line) => {
      if (!accountIds.has(line.account_id)) issues.push({ code: 'ACCOUNT_MISSING', entryId: entry.id, lineId: line.id });
    });
  }

  return { healthy: issues.length === 0, issues };
}

module.exports = { inspectAccountingIntegrity };
