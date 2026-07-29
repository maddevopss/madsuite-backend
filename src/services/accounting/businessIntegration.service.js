const EVENT_MAPPINGS = Object.freeze({
  invoice_finalized: {
    debitSystemKey: 'accounts_receivable',
    creditSystemKey: 'sales_revenue',
  },
  payment_received: {
    debitSystemKey: 'cash',
    creditSystemKey: 'accounts_receivable',
  },
  expense_recorded: {
    debitSystemKey: 'operating_expense',
    creditSystemKey: 'accounts_payable',
  },
});

function buildEntryFromBusinessEvent(event) {
  const mapping = EVENT_MAPPINGS[event.type];
  if (!mapping) throw new Error('ACCOUNTING_EVENT_UNSUPPORTED');
  const amount = Math.round(Number(event.amount || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error('ACCOUNTING_EVENT_AMOUNT_INVALID');
  return {
    entryDate: event.date,
    memo: event.memo || event.type,
    referenceType: event.referenceType || event.type,
    referenceId: String(event.referenceId),
    idempotencyKey: `accounting:${event.type}:${event.referenceId}`,
    lines: [
      { systemKey: mapping.debitSystemKey, debit: amount, credit: 0 },
      { systemKey: mapping.creditSystemKey, debit: 0, credit: amount },
    ],
  };
}

function summarizeAccountingDashboard({ receivables = 0, payables = 0, revenue = 0, expenses = 0 }) {
  return {
    receivables: Number(receivables),
    payables: Number(payables),
    revenue: Number(revenue),
    expenses: Number(expenses),
    netIncome: Math.round((Number(revenue) - Number(expenses)) * 100) / 100,
  };
}

module.exports = { EVENT_MAPPINGS, buildEntryFromBusinessEvent, summarizeAccountingDashboard };
