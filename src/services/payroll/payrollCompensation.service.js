const normalizeCompensation = (input = {}) => {
  const amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("PAYROLL_COMPENSATION_INVALID");
  if (!["hourly", "annual"].includes(input.basis)) throw new Error("PAYROLL_COMPENSATION_BASIS_INVALID");
  return Object.freeze({
    employeeId: input.employeeId,
    basis: input.basis,
    amountCents,
    standardHoursPerWeek: Number(input.standardHoursPerWeek || 40),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo || null,
  });
};

const resolveEffectiveCompensation = (contracts, date) => {
  const target = new Date(date).getTime();
  return [...contracts]
    .filter((contract) => new Date(contract.effectiveFrom).getTime() <= target && (!contract.effectiveTo || new Date(contract.effectiveTo).getTime() >= target))
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0] || null;
};

module.exports = { normalizeCompensation, resolveEffectiveCompensation };
