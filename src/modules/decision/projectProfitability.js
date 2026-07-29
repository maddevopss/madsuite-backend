function calculateProjectProfitability({ revenueCents = 0, labourCents = 0, expenseCents = 0 }) {
  const costCents = Number(labourCents) + Number(expenseCents);
  return { costCents, profitCents: Number(revenueCents) - costCents };
}

module.exports = { calculateProjectProfitability };
