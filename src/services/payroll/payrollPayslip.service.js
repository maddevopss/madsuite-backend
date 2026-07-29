const buildPayslip = ({ employee, period, earnings = [], deductions = [], employerContributions = [], vacation, netCents }) => {
  const grossCents = earnings.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  const deductionTotalCents = deductions.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  if (grossCents - deductionTotalCents !== Number(netCents)) throw new Error("PAYROLL_PAYSLIP_TOTAL_MISMATCH");
  return Object.freeze({
    employee: Object.freeze({ id: employee.id, employeeNumber: employee.employeeNumber, name: employee.name }),
    period: Object.freeze({ ...period }),
    earnings: Object.freeze([...earnings]),
    deductions: Object.freeze([...deductions]),
    employerContributions: Object.freeze([...employerContributions]),
    vacation: vacation ? Object.freeze({ ...vacation }) : null,
    totals: Object.freeze({ grossCents, deductionTotalCents, netCents: Number(netCents) }),
  });
};

module.exports = { buildPayslip };
