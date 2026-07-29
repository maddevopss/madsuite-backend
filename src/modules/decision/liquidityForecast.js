function forecastLiquidity({ openingCents = 0, expectedReceiptsCents = 0, expectedPaymentsCents = 0, payrollCents = 0 }) {
  return Number(openingCents) + Number(expectedReceiptsCents) - Number(expectedPaymentsCents) - Number(payrollCents);
}

module.exports = { forecastLiquidity };
