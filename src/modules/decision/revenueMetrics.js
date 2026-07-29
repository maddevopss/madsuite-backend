function calculateRevenue({ invoicedCents = 0, creditedCents = 0, refundedCents = 0 }) {
  return Number(invoicedCents) - Number(creditedCents) - Number(refundedCents);
}

module.exports = { calculateRevenue };
