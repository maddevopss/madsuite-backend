'use strict';

function provisionBadDebt(receivables = [], policy = {}) {
  const rates = { current: 0, '1_30': 0.01, '31_60': 0.05, '61_90': 0.15, over_90: 0.5, ...policy.rates };
  const lines = receivables.map((row) => ({
    invoiceId: row.id,
    customerId: row.customerId,
    balanceCents: row.balanceCents,
    bucket: row.bucket,
    provisionCents: Math.round(row.balanceCents * (rates[row.bucket] || 0)),
  }));
  return { lines, totalProvisionCents: lines.reduce((sum, line) => sum + line.provisionCents, 0) };
}

function buildWriteOffEntry(invoice, accounts) {
  if (!invoice?.balanceCents || invoice.balanceCents <= 0) throw new Error('BAD_DEBT_BALANCE_REQUIRED');
  return {
    reference: `bad-debt:${invoice.id}`,
    idempotencyKey: `bad-debt:${invoice.id}`,
    lines: [
      { accountId: accounts.badDebtExpenseId, debitCents: invoice.balanceCents, creditCents: 0 },
      { accountId: accounts.accountsReceivableId, debitCents: 0, creditCents: invoice.balanceCents },
    ],
  };
}

module.exports = { buildWriteOffEntry, provisionBadDebt };
