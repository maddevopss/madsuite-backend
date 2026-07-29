const roundCents = (value) => Math.round(Number(value));

const calculateHourlyGross = ({ regularSeconds = 0, overtimeSeconds = 0, hourlyRateCents, overtimeMultiplier = 1.5 }) => {
  if (!Number.isInteger(hourlyRateCents) || hourlyRateCents <= 0) throw new Error("PAYROLL_HOURLY_RATE_INVALID");
  const regularCents = roundCents((regularSeconds / 3600) * hourlyRateCents);
  const overtimeCents = roundCents((overtimeSeconds / 3600) * hourlyRateCents * overtimeMultiplier);
  return Object.freeze({ regularCents, overtimeCents, grossCents: regularCents + overtimeCents });
};

const calculateSalaryGross = ({ annualSalaryCents, periodsPerYear }) => {
  if (!Number.isInteger(annualSalaryCents) || annualSalaryCents <= 0 || !Number.isInteger(periodsPerYear) || periodsPerYear <= 0) {
    throw new Error("PAYROLL_SALARY_INPUT_INVALID");
  }
  return Object.freeze({ grossCents: roundCents(annualSalaryCents / periodsPerYear) });
};

module.exports = { calculateHourlyGross, calculateSalaryGross };
