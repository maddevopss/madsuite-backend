function calculateCashFlow({ openingCents = 0, inflowCents = 0, outflowCents = 0 }) {
  const netCents = Number(inflowCents) - Number(outflowCents);
  return { netCents, closingCents: Number(openingCents) + netCents };
}

module.exports = { calculateCashFlow };
