const CONTRACT_TYPES = new Set(['permanent', 'fixed_term', 'temporary', 'casual', 'internship']);
const EMPLOYMENT_CLASSES = new Set(['full_time', 'part_time', 'on_call']);
const PAY_FREQUENCIES = new Set(['weekly', 'biweekly', 'semimonthly', 'monthly']);

function toMoney(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('compensation must be greater than zero');
  return Number(amount.toFixed(2));
}

function normalizeEmploymentContract(input = {}) {
  const contractNumber = String(input.contractNumber || '').trim();
  const contractType = String(input.contractType || '').trim();
  const employmentClass = String(input.employmentClass || '').trim();
  const payType = String(input.payType || '').trim();
  const payFrequency = String(input.payFrequency || '').trim();
  const effectiveFrom = String(input.effectiveFrom || '').trim();
  const effectiveTo = input.effectiveTo ? String(input.effectiveTo).trim() : null;
  const standardHoursPerWeek = Number(input.standardHoursPerWeek);

  if (!contractNumber) throw new Error('contractNumber is required');
  if (!CONTRACT_TYPES.has(contractType)) throw new Error('invalid contractType');
  if (!EMPLOYMENT_CLASSES.has(employmentClass)) throw new Error('invalid employmentClass');
  if (!['hourly', 'salary'].includes(payType)) throw new Error('invalid payType');
  if (!PAY_FREQUENCIES.has(payFrequency)) throw new Error('invalid payFrequency');
  if (!effectiveFrom) throw new Error('effectiveFrom is required');
  if (!Number.isFinite(standardHoursPerWeek) || standardHoursPerWeek < 0 || standardHoursPerWeek > 168) {
    throw new Error('standardHoursPerWeek must be between 0 and 168');
  }
  if (effectiveTo && new Date(effectiveTo) < new Date(effectiveFrom)) {
    throw new Error('effectiveTo cannot precede effectiveFrom');
  }

  const hourlyRate = payType === 'hourly' ? toMoney(input.hourlyRate) : null;
  const annualSalary = payType === 'salary' ? toMoney(input.annualSalary) : null;

  if (payType === 'hourly' && input.annualSalary != null) throw new Error('annualSalary is not allowed for hourly contracts');
  if (payType === 'salary' && input.hourlyRate != null) throw new Error('hourlyRate is not allowed for salary contracts');

  return {
    contractNumber,
    contractType,
    employmentClass,
    payType,
    hourlyRate,
    annualSalary,
    standardHoursPerWeek,
    payFrequency,
    effectiveFrom,
    effectiveTo,
    terms: input.terms && typeof input.terms === 'object' && !Array.isArray(input.terms) ? input.terms : {},
  };
}

function canActivateContract(contract = {}) {
  return contract.status === 'draft'
    && Boolean(contract.approvedBy)
    && Boolean(contract.approvedAt)
    && Boolean(contract.effectiveFrom);
}

module.exports = {
  CONTRACT_TYPES,
  EMPLOYMENT_CLASSES,
  PAY_FREQUENCIES,
  normalizeEmploymentContract,
  canActivateContract,
};
