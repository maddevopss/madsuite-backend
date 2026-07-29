function calculateProfit({ revenueCents = 0, expenseCents = 0 }) {
  const profitCents = Number(revenueCents) - Number(expenseCents);
  const marginPercent = Number(revenueCents) === 0 ? null : (profitCents / Number(revenueCents)) * 100;
  return { profitCents, marginPercent };
}

module.exports = { calculateProfit };
