const applyRate = (baseCents, rate, maximumCents = null) => {
  const raw = Math.round(Number(baseCents) * Number(rate));
  return maximumCents == null ? raw : Math.min(raw, Number(maximumCents));
};

const calculatePayrollCharges = ({ grossCents, employeeRules = [], employerRules = [] }) => {
  const calculate = (rule) => ({
    code: rule.code,
    amountCents: rule.fixedCents != null
      ? Number(rule.fixedCents)
      : applyRate(grossCents, rule.rate || 0, rule.maximumPerPeriodCents),
  });
  const deductions = employeeRules.map(calculate);
  const employerContributions = employerRules.map(calculate);
  return Object.freeze({
    deductions,
    employerContributions,
    deductionTotalCents: deductions.reduce((sum, row) => sum + row.amountCents, 0),
    employerContributionTotalCents: employerContributions.reduce((sum, row) => sum + row.amountCents, 0),
  });
};

module.exports = { applyRate, calculatePayrollCharges };
