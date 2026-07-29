const buildRemittance = ({ authorityCode, period, employeeDeductions = [], employerContributions = [] }) => {
  if (!authorityCode || !period?.endDate) throw new Error("PAYROLL_REMITTANCE_SCOPE_REQUIRED");
  const employeeCents = employeeDeductions.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  const employerCents = employerContributions.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  return Object.freeze({
    authorityCode,
    period: Object.freeze({ ...period }),
    employeeCents,
    employerCents,
    totalCents: employeeCents + employerCents,
    idempotencyKey: `payroll-remittance:${authorityCode}:${period.endDate}`,
    status: "prepared",
  });
};

module.exports = { buildRemittance };
