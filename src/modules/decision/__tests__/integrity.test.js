const { calculateProfit } = require('../profitMetrics');
const { calculateCashFlow } = require('../cashflowMetrics');

describe('decision metrics integrity', () => {
  test('profit remains balanced', () => {
    expect(calculateProfit({ revenueCents: 10000, expenseCents: 4000 }).profitCents).toBe(6000);
  });

  test('cash flow closes correctly', () => {
    expect(calculateCashFlow({ openingCents: 5000, inflowCents: 3000, outflowCents: 1000 }).closingCents).toBe(7000);
  });
});
