const accrueVacation = ({ eligibleGrossCents, accrualRate, openingBalanceCents = 0, paidOutCents = 0 }) => {
  const accruedCents = Math.round(Number(eligibleGrossCents) * Number(accrualRate));
  const closingBalanceCents = Number(openingBalanceCents) + accruedCents - Number(paidOutCents);
  if (closingBalanceCents < 0) throw new Error("PAYROLL_VACATION_BALANCE_NEGATIVE");
  return Object.freeze({ openingBalanceCents, accruedCents, paidOutCents, closingBalanceCents });
};

const calculatePaidLeave = ({ hours, hourlyRateCents }) => {
  if (Number(hours) < 0 || Number(hourlyRateCents) < 0) throw new Error("PAYROLL_LEAVE_INPUT_INVALID");
  return Math.round(Number(hours) * Number(hourlyRateCents));
};

module.exports = { accrueVacation, calculatePaidLeave };
