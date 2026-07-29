const buildPayrollDashboard = ({ runs = [], remittances = [], employees = [] }) => {
  const latestRun = [...runs].sort((a, b) => new Date(b.payDate) - new Date(a.payDate))[0] || null;
  const pendingRemittancesCents = remittances
    .filter((row) => row.status !== "paid")
    .reduce((sum, row) => sum + Number(row.totalCents || 0), 0);
  const activeEmployees = employees.filter((row) => row.active !== false).length;
  return Object.freeze({
    activeEmployees,
    latestRun,
    pendingRemittancesCents,
    yearToDateGrossCents: runs.reduce((sum, row) => sum + Number(row.grossCents || 0), 0),
    yearToDateNetCents: runs.reduce((sum, row) => sum + Number(row.netCents || 0), 0),
    attention: Object.freeze([
      ...(pendingRemittancesCents > 0 ? ["REMITTANCES_PENDING"] : []),
      ...(runs.some((row) => row.status === "draft") ? ["PAYROLL_RUN_DRAFT"] : []),
    ]),
  });
};

module.exports = { buildPayrollDashboard };
