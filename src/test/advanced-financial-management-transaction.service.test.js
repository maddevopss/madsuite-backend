const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/advanced-financial-management-transaction.service');

const evaluate = (policy, input, idempotencyKey = 'finance-test-key') => evaluatePolicy({
  policy,
  input,
  idempotencyKey,
});

describe('advanced financial management transaction policies', () => {
  test('refuse l’auto-approbation d’un budget', async () => {
    const result = await evaluate('finance.budget.approve@1', {
      budgetId: 1,
      ownerUserId: 2,
      approvedByUserId: 2,
      allocations: ['operations'],
      assumptions: ['growth'],
      approvalEvidence: ['minutes'],
      totalRevenue: 100000,
      totalExpense: 90000,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('finance.budget_independent_approval_required');
  });

  test('refuse une prévision sans hypothèses', async () => {
    const result = await evaluate('finance.forecast.publish@1', {
      forecastId: 1,
      preparedByUserId: 1,
      approvedByUserId: 2,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      assumptions: [],
      approvalEvidence: ['approval'],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('finance.forecast_basis_required');
  });

  test('refuse une position de trésorerie non réconciliée', async () => {
    const result = await evaluate('finance.cash_position.record@1', {
      positionDate: '2026-07-25',
      accountReference: 'BANK-1',
      preparedByUserId: 1,
      openingBalance: 1000,
      inflows: 500,
      outflows: 250,
      closingBalance: 1400,
      sourceEvidence: ['bank-statement'],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('finance.cash_position_reconciliation_failed');
  });

  test('refuse une facilité dépassant sa limite', async () => {
    const result = await evaluate('finance.funding_facility.approve@1', {
      facilityNumber: 'FAC-1',
      facilityType: 'credit_line',
      providerName: 'Banque',
      approvedByUserId: 2,
      approvedLimit: 100000,
      drawnAmount: 125000,
      startsAt: '2026-01-01',
      maturesAt: '2027-01-01',
      evidence: ['agreement'],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('finance.facility_amounts_invalid');
  });

  test('refuse l’auto-approbation d’un scénario', async () => {
    const result = await evaluate('finance.scenario.approve@1', {
      scenarioId: 1,
      preparedByUserId: 3,
      approvedByUserId: 3,
      assumptions: ['recession'],
      recommendations: ['reserve'],
      approvalEvidence: ['committee'],
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('finance.scenario_independent_approval_required');
  });
});
