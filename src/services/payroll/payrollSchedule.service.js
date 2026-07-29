const FREQUENCIES = Object.freeze({ weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 });

const buildPayPeriod = ({ frequency, startDate, sequence = 1 }) => {
  if (!FREQUENCIES[frequency]) throw new Error("PAYROLL_FREQUENCY_INVALID");
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error("PAYROLL_PERIOD_START_INVALID");
  const end = new Date(start);
  if (frequency === "weekly") end.setUTCDate(end.getUTCDate() + 6);
  if (frequency === "biweekly") end.setUTCDate(end.getUTCDate() + 13);
  if (frequency === "semimonthly") end.setUTCDate(end.getUTCDate() + 14);
  if (frequency === "monthly") end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return Object.freeze({ frequency, sequence, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), periodsPerYear: FREQUENCIES[frequency] });
};

module.exports = { FREQUENCIES, buildPayPeriod };
