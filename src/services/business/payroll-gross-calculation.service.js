function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw Object.assign(new Error("Montant de paie invalide."), { statusCode: 400 });
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function calculateGrossPay({ employee, inputs = [], rules = {} }) {
  if (!employee || !["hourly", "salary"].includes(employee.pay_type)) {
    throw Object.assign(new Error("Type de rémunération invalide."), { statusCode: 400 });
  }

  const totals = inputs.reduce((acc, input) => {
    const quantity = Number(input.quantity || 0);
    const amount = Number(input.amount || 0);
    acc[input.input_type] = (acc[input.input_type] || 0) + (Number.isFinite(amount) ? amount : 0);
    acc[`${input.input_type}Quantity`] = (acc[`${input.input_type}Quantity`] || 0) + (Number.isFinite(quantity) ? quantity : 0);
    return acc;
  }, {});

  const regularHours = totals.regular_hoursQuantity || 0;
  const overtimeHours = totals.overtime_hoursQuantity || 0;
  const hourlyRate = Number(employee.hourly_rate || 0);
  const periodsPerYear = Number(rules.payPeriodsPerYear || 26);
  const overtimeMultiplier = Number(rules.overtimeMultiplier || 1.5);

  const basePay = employee.pay_type === "salary"
    ? Number(employee.annual_salary || 0) / periodsPerYear
    : regularHours * hourlyRate;
  const overtimePay = employee.pay_type === "hourly" ? overtimeHours * hourlyRate * overtimeMultiplier : 0;
  const bonus = totals.bonus || 0;
  const commission = totals.commission || 0;
  const taxableBenefits = totals.taxable_benefit || 0;
  const adjustment = totals.adjustment || 0;
  const reimbursements = totals.reimbursement || 0;
  const grossPay = roundMoney(basePay + overtimePay + bonus + commission + taxableBenefits + adjustment);

  return {
    basePay: roundMoney(basePay),
    overtimePay: roundMoney(overtimePay),
    bonus: roundMoney(bonus),
    commission: roundMoney(commission),
    taxableBenefits: roundMoney(taxableBenefits),
    adjustment: roundMoney(adjustment),
    reimbursements: roundMoney(reimbursements),
    grossPay,
    payableBeforeDeductions: roundMoney(grossPay + reimbursements),
    trace: { regularHours, overtimeHours, hourlyRate, periodsPerYear, overtimeMultiplier },
  };
}

module.exports = { roundMoney, calculateGrossPay };
