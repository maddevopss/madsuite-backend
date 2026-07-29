function forecastRevenue({ recurringCents = 0, pipelineCents = 0, pipelineProbability = 0, historicalCents = 0 }) {
  return Math.round(Number(recurringCents) + Number(pipelineCents) * Number(pipelineProbability) + Number(historicalCents));
}

module.exports = { forecastRevenue };
