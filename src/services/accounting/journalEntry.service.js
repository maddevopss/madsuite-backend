function money(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('ACCOUNTING_AMOUNT_INVALID');
  return Math.round(amount * 100) / 100;
}

function validateBalancedEntry(lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error('ACCOUNTING_ENTRY_REQUIRES_TWO_LINES');
  const normalized = lines.map((line) => ({
    accountId: line.accountId,
    description: line.description || null,
    debit: money(line.debit),
    credit: money(line.credit),
  }));
  normalized.forEach((line) => {
    if (!line.accountId || (line.debit > 0) === (line.credit > 0)) throw new Error('ACCOUNTING_LINE_INVALID');
  });
  const debitCents = normalized.reduce((sum, line) => sum + Math.round(line.debit * 100), 0);
  const creditCents = normalized.reduce((sum, line) => sum + Math.round(line.credit * 100), 0);
  if (debitCents !== creditCents) throw new Error('ACCOUNTING_ENTRY_UNBALANCED');
  return normalized;
}

module.exports = { money, validateBalancedEntry };
