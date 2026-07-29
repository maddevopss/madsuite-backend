const { buildEntryFromBusinessEvent, summarizeAccountingDashboard } = require('../services/accounting/businessIntegration.service');

describe('accounting business integration', () => {
  test('maps a finalized invoice to receivable and revenue', () => {
    const entry = buildEntryFromBusinessEvent({ type: 'invoice_finalized', amount: 300, date: '2026-07-29', referenceId: 42 });
    expect(entry.idempotencyKey).toBe('accounting:invoice_finalized:42');
    expect(entry.lines).toEqual([
      { systemKey: 'accounts_receivable', debit: 300, credit: 0 },
      { systemKey: 'sales_revenue', debit: 0, credit: 300 },
    ]);
  });

  test('computes dashboard net income', () => {
    expect(summarizeAccountingDashboard({ revenue: 1000, expenses: 325 }).netIncome).toBe(675);
  });
});
