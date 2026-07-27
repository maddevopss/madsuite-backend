const { roundMoney } = require("./payroll-gross-calculation.service");

function activeRule(rule, payDate) {
  const date = new Date(payDate);
  const from = rule.effectiveFrom ? new Date(rule.effectiveFrom) : null;
  const to = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
  return (!from || date >= from) && (!to || date <= to);
}

function calculateComponent(base, rule) {
  const exempt = Number(rule.exemption || 0);
  const taxableBase = Math.max(0, Number(base) - exempt);
  const raw = taxableBase * Number(rule.rate || 0) + Number(rule.fixedAmount || 0);
  const capped = rule.maximum == null ? raw : Math.min(raw, Number(rule.maximum));
  return roundMoney(Math.max(0, capped));
}

function calculateNetPay({ grossPay, reimbursements = 0, payDate, employeeDeductions = [], employerContributions = [], voluntaryDeductions = [] }) {
  const apply = (rules) => rules
    .filter((rule) => activeRule(rule, payDate))
    .map((rule) => ({ code: rule.code, amount: calculateComponent(grossPay, rule), ruleVersion: rule.version }));

  const statutory = apply(employeeDeductions);
  const voluntary = apply(voluntaryDeductions);
  const employer = apply(employerContributions);
  const employeeTotal = roundMoney([...statutory, ...voluntary].reduce((sum, row) => sum + row.amount, 0));
  const employerTotal = roundMoney(employer.reduce((sum, row) => sum + row.amount, 0));
  const netPay = roundMoney(Number(grossPay) + Number(reimbursements) - employeeTotal);

  if (netPay < 0) {
    throw Object.assign(new Error("Les retenues dépassent le montant payable."), { statusCode: 409 });
  }

  return {
    grossPay: roundMoney(grossPay),
    reimbursements: roundMoney(reimbursements),
    statutoryDeductions: statutory,
    voluntaryDeductions: voluntary,
    employerContributions: employer,
    employeeDeductionTotal: employeeTotal,
    employerContributionTotal: employerTotal,
    netPay,
  };
}

module.exports = { activeRule, calculateComponent, calculateNetPay };
