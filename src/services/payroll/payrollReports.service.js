const buildPayrollRegister = (runs = []) => Object.freeze({
  runCount: runs.length,
  employeePayments: runs.reduce((sum, run) => sum + Number(run.employeeCount || 0), 0),
  grossCents: runs.reduce((sum, run) => sum + Number(run.grossCents || 0), 0),
  deductionsCents: runs.reduce((sum, run) => sum + Number(run.deductionsCents || 0), 0),
  employerContributionsCents: runs.reduce((sum, run) => sum + Number(run.employerContributionsCents || 0), 0),
  netCents: runs.reduce((sum, run) => sum + Number(run.netCents || 0), 0),
});

const buildEmployeeYearToDate = (items = []) => Object.freeze(items.reduce((totals, item) => {
  totals.grossCents += Number(item.grossCents || 0);
  totals.deductionsCents += Number(item.deductionTotalCents || 0);
  totals.netCents += Number(item.netCents || 0);
  return totals;
}, { grossCents: 0, deductionsCents: 0, netCents: 0 }));

module.exports = { buildPayrollRegister, buildEmployeeYearToDate };
