const { registerPolicy } = require('./transaction-engine.service');

const BUDGET_APPROVE_POLICY = 'finance.budget.approve@1';
const FORECAST_PUBLISH_POLICY = 'finance.forecast.publish@1';
const CASH_POSITION_RECORD_POLICY = 'finance.cash_position.record@1';
const FUNDING_FACILITY_APPROVE_POLICY = 'finance.funding_facility.approve@1';
const SCENARIO_APPROVE_POLICY = 'finance.scenario.approve@1';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value) => Array.isArray(value) && value.length > 0;
const validIdempotency = (value) => hasText(value) && value.trim().length >= 8;
const requireKey = (idempotencyKey) => validIdempotency(idempotencyKey)
  ? null
  : { allowed: false, statusCode: 400, code: 'finance.idempotency_required' };

registerPolicy('finance.budget.approve', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.budgetId || !input?.ownerUserId || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'finance.budget_approval_required' };
  if (String(input.ownerUserId) === String(input.approvedByUserId)) return { allowed: false, statusCode: 409, code: 'finance.budget_independent_approval_required' };
  if (!hasItems(input?.allocations) || !hasItems(input?.assumptions)) return { allowed: false, statusCode: 409, code: 'finance.budget_basis_required' };
  if (!hasItems(input?.approvalEvidence)) return { allowed: false, statusCode: 409, code: 'finance.budget_evidence_required' };
  if (Number(input.totalRevenue) < 0 || Number(input.totalExpense) < 0) return { allowed: false, statusCode: 400, code: 'finance.budget_totals_invalid' };
  return { allowed: true, code: 'finance.budget_approve_allowed' };
});

registerPolicy('finance.forecast.publish', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.forecastId || !input?.preparedByUserId || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'finance.forecast_approval_required' };
  if (String(input.preparedByUserId) === String(input.approvedByUserId)) return { allowed: false, statusCode: 409, code: 'finance.forecast_independent_approval_required' };
  if (!input?.periodStart || !input?.periodEnd || new Date(input.periodEnd) < new Date(input.periodStart)) return { allowed: false, statusCode: 400, code: 'finance.forecast_period_invalid' };
  if (!hasItems(input?.assumptions) || !hasItems(input?.approvalEvidence)) return { allowed: false, statusCode: 409, code: 'finance.forecast_basis_required' };
  return { allowed: true, code: 'finance.forecast_publish_allowed' };
});

registerPolicy('finance.cash_position.record', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.positionDate || !hasText(input?.accountReference) || !input?.preparedByUserId) return { allowed: false, statusCode: 400, code: 'finance.cash_position_fields_required' };
  if (!hasItems(input?.sourceEvidence)) return { allowed: false, statusCode: 409, code: 'finance.cash_position_evidence_required' };
  const expected = Number(input.openingBalance) + Number(input.inflows || 0) - Number(input.outflows || 0);
  if (Math.abs(expected - Number(input.closingBalance)) > 0.01) return { allowed: false, statusCode: 409, code: 'finance.cash_position_reconciliation_failed' };
  return { allowed: true, code: 'finance.cash_position_record_allowed' };
});

registerPolicy('finance.funding_facility.approve', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!hasText(input?.facilityNumber) || !hasText(input?.facilityType) || !hasText(input?.providerName) || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'finance.facility_fields_required' };
  if (Number(input.approvedLimit) <= 0 || Number(input.drawnAmount || 0) < 0 || Number(input.drawnAmount || 0) > Number(input.approvedLimit)) return { allowed: false, statusCode: 400, code: 'finance.facility_amounts_invalid' };
  if (!input?.startsAt || !input?.maturesAt || new Date(input.maturesAt) < new Date(input.startsAt)) return { allowed: false, statusCode: 400, code: 'finance.facility_period_invalid' };
  if (!hasItems(input?.evidence)) return { allowed: false, statusCode: 409, code: 'finance.facility_evidence_required' };
  return { allowed: true, code: 'finance.facility_approve_allowed' };
});

registerPolicy('finance.scenario.approve', '1', ({ input, idempotencyKey }) => {
  const keyError = requireKey(idempotencyKey); if (keyError) return keyError;
  if (!input?.scenarioId || !input?.preparedByUserId || !input?.approvedByUserId) return { allowed: false, statusCode: 400, code: 'finance.scenario_approval_required' };
  if (String(input.preparedByUserId) === String(input.approvedByUserId)) return { allowed: false, statusCode: 409, code: 'finance.scenario_independent_approval_required' };
  if (!hasItems(input?.assumptions) || !hasItems(input?.recommendations) || !hasItems(input?.approvalEvidence)) return { allowed: false, statusCode: 409, code: 'finance.scenario_basis_required' };
  return { allowed: true, code: 'finance.scenario_approve_allowed' };
});

module.exports = {
  BUDGET_APPROVE_POLICY,
  FORECAST_PUBLISH_POLICY,
  CASH_POSITION_RECORD_POLICY,
  FUNDING_FACILITY_APPROVE_POLICY,
  SCENARIO_APPROVE_POLICY,
};
