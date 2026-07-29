function calculateExpenses({ operatingCents = 0, payrollCents = 0, supplierCents = 0 }) {
  return Number(operatingCents) + Number(payrollCents) + Number(supplierCents);
}

module.exports = { calculateExpenses };
